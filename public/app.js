const list = document.querySelector("#movie-list");
const statusText = document.querySelector("#status");
const search = document.querySelector("#search");
const dialog = document.querySelector("#details");

let movies = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
let detailsRequest = 0;

async function showDetails(movie) {
  const requestId = ++detailsRequest;

  document.querySelector("#detail-title").textContent = movie.title;
  document.querySelector("#detail-info").textContent =
    `${movie.duration_minutes} минут · ${movie.age_limit}+`;

  let screeningsList = document.querySelector("#screenings-list");

  if (!screeningsList) {
    screeningsList = element("div", "screenings-list");
    screeningsList.id = "screenings-list";

    const info = document.querySelector("#detail-info");
    const placeholder = info.nextElementSibling;

    if (
      placeholder &&
      placeholder.textContent.includes("келесі қадамда")
    ) {
      placeholder.remove();
    }

    info.after(screeningsList);
  }

  screeningsList.textContent = "Сеанстар жүктелуде…";

  if (!dialog.open) {
    dialog.showModal();
  }

  try {
    const response = await fetch(
      `/api/movies/${movie.movie_id}/screenings`
    );

    if (!response.ok) {
      throw new Error("Сеанстар жүктелмеді.");
    }

    const screenings = await response.json();

    if (!Array.isArray(screenings)) {
      throw new Error("Жауап форматы дұрыс емес.");
    }

    if (requestId !== detailsRequest) return;

    screeningsList.replaceChildren();

    if (screenings.length === 0) {
      screeningsList.textContent = "Бұл фильмге сеанс жоқ.";
      return;
    }

    const dateFormat = new Intl.DateTimeFormat("kk-KZ", {
      timeZone: "Asia/Qyzylorda",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    screenings.forEach((screening) => {
      const card = element("div", "screening-card");
      const date = new Date(screening.starts_at);

      const price = Number(screening.ticket_price)
        .toLocaleString("kk-KZ");

      card.append(
        element("h3", "", screening.hall),
        element("p", "metadata", dateFormat.format(date)),
        element("p", "screening-price", `${price} ₸`)
      );

      if (date.getTime() <= Date.now()) {
        card.append(element("p", "metadata", "Сеанс өтіп кеткен"));
      }

const chooseButton = element(
  "button",
  "card-button",
  "Орын таңдау"
);
chooseButton.type = "button";
chooseButton.disabled = date.getTime() <= Date.now();

chooseButton.addEventListener("click", () => {
  showSeats(screening, card);
});

card.append(chooseButton);

      screeningsList.append(card);
    });
  } catch (error) {
    if (requestId !== detailsRequest) return;

    screeningsList.textContent =
      "Сеанстарды жүктеу мүмкін болмады.";
    console.error(error);
  }
}

function render() {
  const query = search.value.trim().toLocaleLowerCase();
  const filtered = movies.filter(movie =>
    movie.title.toLocaleLowerCase().includes(query)
  );

  list.replaceChildren();
  statusText.textContent = filtered.length
    ? `${filtered.length} фильм табылды`
    : "Фильм табылмады.";

  filtered.forEach(movie => {
    const card = element("article", "movie-card");
    const poster = element("div", "poster");
    poster.dataset.theme = String(Number(movie.movie_id) % 5);
    poster.setAttribute("aria-hidden", "true");

    poster.append(
      element("span", "poster-label", "CINEMA COLLECTION"),
      element("span", "poster-letter", movie.title.charAt(0)),
      element("span", "age", `${movie.age_limit}+`)
    );

    const body = element("div", "card-body");
    const button = element("button", "card-button", "Толығырақ ↗");
    button.type = "button";
    button.setAttribute("aria-label", `${movie.title}: толығырақ`);
    button.addEventListener("click", () => showDetails(movie));

    body.append(
      element("h3", "", movie.title),
      element(
        "p",
        "metadata",
        `${movie.duration_minutes} минут · ${movie.age_limit}+`
      ),
      button
    );

    card.append(poster, body);
    list.append(card);
  });
}

async function loadMovies() {
  try {
    const response = await fetch("/api/movies");
    if (!response.ok) throw new Error("Фильмдер жүктелмеді.");

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Жауап форматы дұрыс емес.");

    movies = data;
    render();
  } catch (error) {
    statusText.textContent =
      "Фильмдерді жүктеу мүмкін болмады. Серверді тексеріп, бетті жаңартыңыз.";
    console.error(error);
  }
}

search.addEventListener("input", render);
document.querySelector("#close-details").addEventListener(
  "click", () => dialog.close()
);

loadMovies();

async function showSeats(screening, card) {
  let panel = card.querySelector(".seat-panel");

  if (panel) {
    panel.hidden = !panel.hidden;
    return;
  }

  panel = element("div", "seat-panel");
  panel.textContent = "Орындар жүктелуде…";
  card.append(panel);

  try {
    const response = await fetch(
      `/api/screenings/${screening.screening_id}/seats`
    );

    if (!response.ok) {
      throw new Error("Орындар жүктелмеді.");
    }

    const seats = await response.json();

    if (!Array.isArray(seats)) {
      throw new Error("Жауап форматы дұрыс емес.");
    }

    panel.replaceChildren();

    if (seats.length === 0) {
      panel.textContent = "Бұл залда орындар жоқ.";
      return;
    }

    panel.append(
      element("div", "cinema-screen", "ЭКРАН"),
      element(
        "p",
        "metadata",
        "Сұр — бос емес · Жасыл — таңдалған"
      )
    );

    const rows = element("div", "seat-rows");
    const summary = element(
      "p",
      "seat-summary",
      "Орын таңдаңыз."
    );
    summary.setAttribute("aria-live", "polite");

    const selected = new Map();
    const rowContainers = new Map();

    function updateSummary() {
      const chosen = [...selected.values()];
      const total =
        chosen.length * Number(screening.ticket_price);

      summary.textContent = chosen.length
        ? `Таңдалды: ${
            chosen.map((seat) =>
              `${seat.row_number}-қатар, ${seat.seat_number}-орын`
            ).join("; ")
          }. Барлығы: ${total.toLocaleString("kk-KZ")} ₸`
        : "Орын таңдаңыз.";
    }

    seats.forEach((seat) => {
      if (!rowContainers.has(seat.row_number)) {
        const row = element("div", "seat-row");

        row.append(
          element("span", "row-label", `${seat.row_number}`)
        );

        rowContainers.set(seat.row_number, row);
        rows.append(row);
      }

      const button = element(
        "button",
        "seat",
        String(seat.seat_number)
      );

      button.type = "button";
      button.disabled = seat.is_booked;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute(
        "aria-label",
        `${seat.row_number}-қатар, ${seat.seat_number}-орын${
          seat.is_booked ? ", бос емес" : ""
        }`
      );

      button.addEventListener("click", () => {
        if (selected.has(seat.seat_id)) {
          selected.delete(seat.seat_id);
        } else {
          selected.set(seat.seat_id, seat);
        }

        const isSelected = selected.has(seat.seat_id);

        button.classList.toggle("selected", isSelected);
        button.setAttribute(
          "aria-pressed",
          String(isSelected)
        );

        updateSummary();
      });

      rowContainers.get(seat.row_number).append(button);
    });

    
    panel.append(rows, summary);

const form = element("form", "booking-form");

const nameLabel = element("label", "", "Аты-жөніңіз");
const nameInput = element("input", "booking-input");
nameInput.type = "text";
nameInput.name = "full_name";
nameInput.required = true;
nameInput.maxLength = 100;
nameInput.autocomplete = "name";
nameLabel.append(nameInput);

const emailLabel = element("label", "", "Email");
const emailInput = element("input", "booking-input");
emailInput.type = "email";
emailInput.name = "email";
emailInput.required = true;
emailInput.maxLength = 100;
emailInput.autocomplete = "email";
emailLabel.append(emailInput);

const submitButton = element(
  "button",
  "card-button",
  "Брондау"
);
submitButton.type = "submit";

const message = element("p", "booking-message");
message.setAttribute("role", "status");

form.append(
  nameLabel,
  emailLabel,
  element(
    "p",
    "metadata",
    "Брондау орындарды сақтайды. Төлем кейін жасалады."
  ),
  submitButton,
  message
);

panel.append(form);

let submitting = false;
let completed = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (submitting || completed) return;

  if (selected.size === 0 || selected.size > 10) {
    message.textContent = "1–10 орын таңдаңыз.";
    return;
  }

  if (!nameInput.value.trim()) {
    message.textContent = "Аты-жөніңізді енгізіңіз.";
    return;
  }

  submitting = true;
  submitButton.disabled = true;
  submitButton.textContent = "Сақталуда…";

  const seatButtons = [...rows.querySelectorAll(".seat")];
  const previousDisabled = seatButtons.map(
    button => button.disabled
  );

  seatButtons.forEach(button => {
    button.disabled = true;
  });

  message.textContent = "";

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        full_name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        screening_id: Number(screening.screening_id),
        seat_ids: [...selected.keys()].map(Number)
      })
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        completed = true;
        submitButton.textContent = "Орындарды қайта жүктеңіз";

        const reload = element(
          "button",
          "card-button",
          "Орындарды қайта жүктеу"
        );
        reload.type = "button";
        reload.addEventListener("click", () => {
          panel.remove();
          showSeats(screening, card);
        });
        form.append(reload);
      }

      throw new Error(
        result.error || "Брондау сақталмады."
      );
    }

    completed = true;
    nameInput.disabled = true;
    emailInput.disabled = true;
    submitButton.textContent = "Брондау сақталды";

    message.textContent =
      `Брондау №${result.booking_id}. ` +
      `Барлығы: ${Number(result.total)
        .toLocaleString("kk-KZ")} ₸. ` +
      "Төлем жасалған жоқ.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitting = false;

    if (!completed) {
      submitButton.disabled = false;
      submitButton.textContent = "Брондау";

      seatButtons.forEach((button, index) => {
        button.disabled = previousDisabled[index];
      });
    }
  }
});

  } catch (error) {
    panel.textContent = "Орындарды жүктеу мүмкін болмады.";

    const retry = element(
      "button",
      "card-button",
      "Қайта жүктеу"
    );
    retry.type = "button";
    retry.addEventListener("click", () => {
      panel.remove();
      showSeats(screening, card);
    });

    panel.append(retry);
    console.error(error);
  }
}