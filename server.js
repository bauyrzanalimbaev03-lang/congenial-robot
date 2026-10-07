require("dotenv").config({
  path: require("path").join(__dirname, ".env")
});

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const pool = new Pool({
  connectionTimeoutMillis: 5000
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Фильмдер тізімі
app.get("/api/movies", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        movie_id,
        title,
        duration_minutes,
        release_date,
        age_limit
      FROM movies
      ORDER BY title
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Фильмдерді алу қатесі:", error.message);
    res.status(500).json({
      error: "Фильмдерді жүктеу мүмкін болмады."
    });
  }
});

// Таңдалған фильмнің сеанстары
app.get("/api/movies/:id/screenings", async (req, res) => {
  const movieId = Number(req.params.id);

  if (!Number.isSafeInteger(movieId) || movieId <= 0) {
    return res.status(400).json({
      error: "Фильм нөмірі дұрыс емес."
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        sc.screening_id,
        h.name AS hall,
        sc.starts_at,
        sc.ends_at,
        sc.ticket_price
      FROM screenings sc
      JOIN halls h ON h.hall_id = sc.hall_id
      WHERE sc.movie_id = $1
      ORDER BY sc.starts_at, h.name
    `, [movieId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Сеанстарды алу қатесі:", error.message);
    res.status(500).json({
      error: "Сеанстарды жүктеу мүмкін болмады."
    });
  }
});

pool.on("error", (error) => {
  console.error("База қосылымының қатесі:", error.message);
});
app.get("/api/screenings/:id/seats", async (req, res) => {
  const screeningId = Number(req.params.id);

  if (!Number.isSafeInteger(screeningId) || screeningId <= 0) {
    return res.status(400).json({
      error: "Сеанс нөмірі дұрыс емес."
    });
  }

  try {
    const screening = await pool.query(
      "SELECT hall_id FROM screenings WHERE screening_id = $1",
      [screeningId]
    );

    if (screening.rows.length === 0) {
      return res.status(404).json({
        error: "Сеанс табылмады."
      });
    }

    const result = await pool.query(`
      SELECT
        s.seat_id,
        s.row_number,
        s.seat_number,
        s.seat_type,
        EXISTS (
          SELECT 1
          FROM tickets t
          WHERE t.screening_id = $1
            AND t.seat_id = s.seat_id
            AND t.status = 'active'
        ) AS is_booked
      FROM seats s
      WHERE s.hall_id = $2
      ORDER BY s.row_number, s.seat_number
    `, [screeningId, screening.rows[0].hall_id]);

    res.json(result.rows);
  } catch (error) {
    console.error("Орындарды алу қатесі:", error.message);
    res.status(500).json({
      error: "Орындарды жүктеу мүмкін болмады."
    });
  }
});
app.post("/api/bookings", async (req, res) => {
  const { full_name, email, screening_id, seat_ids } = req.body;
  const screeningId = Number(screening_id);

  if (
    typeof full_name !== "string" ||
    !full_name.trim() ||
    full_name.trim().length > 100 ||
    typeof email !== "string" ||
    email.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    !Number.isSafeInteger(screeningId) ||
    screeningId <= 0 ||
    !Array.isArray(seat_ids) ||
    seat_ids.length === 0 ||
    seat_ids.length > 10 ||
    !seat_ids.every(id => Number.isSafeInteger(id) && id > 0) ||
    new Set(seat_ids).size !== seat_ids.length
  ) {
    return res.status(400).json({
      error: "Аты-жөніңізді, email және 1–10 орынды дұрыс таңдаңыз."
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Бір сеансқа қатар келген брондауларды кезекпен өңдеу
    const screeningResult = await client.query(`
      SELECT
        hall_id,
        ticket_price,
        starts_at > (
          CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Qyzylorda'
        ) AS is_future
      FROM screenings
      WHERE screening_id = $1
      FOR UPDATE
    `, [screeningId]);

    const screening = screeningResult.rows[0];

    if (!screening || !screening.is_future) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Сеанс табылмады немесе басталып кеткен."
      });
    }

    // Орындардың таңдалған залға тиесілі екенін тексеру
    const seatsResult = await client.query(`
      SELECT seat_id
      FROM seats
      WHERE hall_id = $1
        AND seat_id = ANY($2::int[])
    `, [screening.hall_id, seat_ids]);

    if (seatsResult.rows.length !== seat_ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Таңдалған орындар осы залға тиесілі емес."
      });
    }

    const occupied = await client.query(`
      SELECT seat_id
      FROM tickets
      WHERE screening_id = $1
        AND seat_id = ANY($2::int[])
        AND status = 'active'
    `, [screeningId, seat_ids]);

    if (occupied.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Таңдалған орындардың бірі бос емес. Орындарды қайта жүктеңіз."
      });
    }

    const customerEmail = email.trim().toLowerCase();

    await client.query(`
      INSERT INTO customers (full_name, email)
      VALUES ($1, $2)
      ON CONFLICT (email) DO NOTHING
    `, [full_name.trim(), customerEmail]);

    const customerResult = await client.query(`
      SELECT customer_id
      FROM customers
      WHERE email = $1
    `, [customerEmail]);

    const bookingResult = await client.query(`
      INSERT INTO bookings (customer_id, status)
      VALUES ($1, 'pending')
      RETURNING booking_id
    `, [customerResult.rows[0].customer_id]);

    const bookingId = bookingResult.rows[0].booking_id;

    await client.query(`
      INSERT INTO tickets (
        booking_id,
        screening_id,
        seat_id,
        hall_id,
        price,
        status
      )
      SELECT $1, $2, seat_id, $3, $4, 'active'
      FROM unnest($5::int[]) AS chosen(seat_id)
    `, [
      bookingId,
      screeningId,
      screening.hall_id,
      screening.ticket_price,
      seat_ids
    ]);

    await client.query("COMMIT");

    res.status(201).json({
      booking_id: bookingId,
      status: "pending",
      total: Number(screening.ticket_price) * seat_ids.length,
      message: "Брондау сақталды. Төлем жасалған жоқ."
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Брондау қатесі:", error.message);

    res.status(error.code === "23505" ? 409 : 500).json({
      error: error.code === "23505"
        ? "Орын бос емес. Орындарды қайта жүктеңіз."
        : "Брондауды сақтау мүмкін болмады."
    });
  } finally {
    if (client) client.release();
  }
});

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL базасына қосылды!");

    const port = Number(process.env.PORT) || 3000;

    app.listen(port, "0.0.0.0", () => {
      console.log(`Сервер: http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Базаға қосылу қатесі:", error.message);
    await pool.end();
    process.exitCode = 1;
  }
}

start();