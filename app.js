// NASA-client for the web: the same app as the Android version,
// so it can run in Safari on an iPhone.

// DEMO_KEY works for testing but allows only a few requests per hour.
// Get your own free key at https://api.nasa.gov and paste it here.
const API_KEY = "DEMO_KEY";

// NASA's current APOD endpoint. The old api.nasa.gov one can return the NASA logo
// instead of the actual picture.
const BASE_URL = "https://science.nasa.gov/wp-json/wp/v2/apod-basic";
const FIRST_DATE = "1995-06-16"; // NASA's first picture of the day
const FAVORITES_KEY = "favorites";

let currentApod = null;
let requestedDate = null; // null means "the latest picture"
let requestNumber = 0; // Ignores answers to requests the user has moved on from

const $ = (id) => document.getElementById(id);

/** A day with no photo (a video, an empty result, no image URL). Not an error. */
class NoPhotoError extends Error {
    constructor(date) {
        super();
        this.date = date;
    }
}

// ---------- NASA API (like ApodApi.java) ----------

/** Downloads the picture for a date ("yyyy-MM-dd"). Pass null for the latest. */
async function fetchPicture(date) {
    // The new API ignores ?date=. A dated entry uses a /YYMMDD path.
    const path = date ? "/" + date.slice(2).replaceAll("-", "") : "";
    const address = BASE_URL + path + "?per_page=1&api_key=" + API_KEY;

    let response;
    try {
        response = await fetch(address);
    } catch (e) {
        throw new Error("Could not connect. Check your internet connection.");
    }

    if (response.status === 429) {
        throw new Error("Too many requests. Wait a while, or use your own free API key from api.nasa.gov.");
    }
    if (response.status === 404) {
        throw new NoPhotoError(date); // {"message": "APOD not found."}
    }
    if (!response.ok) {
        throw new Error("Could not load the picture (error " + response.status + ").");
    }

    // Latest returns an array; a dated request returns a single object.
    let json = await response.json();
    if (Array.isArray(json)) {
        if (json.length === 0) {
            throw new NoPhotoError(date);
        }
        json = json[0];
    }
    if (!json || !json.date) {
        throw new Error("NASA sent data the app could not read.");
    }
    if (date && json.date !== date) {
        throw new Error("NASA returned a different date. Please try another date.");
    }
    if ((json.media_type || "image") !== "image" || !json.hdurl) {
        throw new NoPhotoError(json.date); // The app shows photos only
    }

    // NASA's text fields are HTML. Turn them into plain text once, here,
    // so saved favorites are already plain text.
    return {
        date: json.date,
        title: plainText(json.title) || "Untitled",
        explanation: plainText(json.explanation),
        hdurl: json.hdurl, // The image itself (url is now an article page)
        copyright: plainText(json.copyright),
    };
}

function plainText(html) {
    // DOMParser doesn't run scripts or load images, so this is safe for NASA's HTML
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    return doc.body.textContent.trim();
}

/** Favorites saved before the API change only have url. */
function imageUrlOf(apod) {
    return apod.hdurl || apod.url;
}

/** Asks NASA for a smaller image instead of the huge full-resolution one. */
function sized(imageUrl, size) {
    try {
        const url = new URL(imageUrl);
        if (url.hostname === "assets.science.nasa.gov") {
            url.search = "?w=" + size + "&h=" + size + "&fit=clip";
        }
        return url.toString();
    } catch (e) {
        return imageUrl;
    }
}

// ---------- Favorites, saved on the phone (like FavoritesStore.java) ----------

function getFavorites() {
    try {
        const list = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
        // Older versions could save videos. The app shows photos only.
        return list.filter((apod) => (apod.media_type || "image") === "image" && imageUrlOf(apod));
    } catch (e) {
        return []; // Saved data is broken or storage is blocked: start empty
    }
}

function saveFavorites(list) {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch (e) {
        showToast("Could not save. Private browsing may be blocking storage.");
    }
}

function isFavorite(date) {
    return getFavorites().some((apod) => apod.date === date);
}

function addFavorite(apod) {
    saveFavorites([apod, ...getFavorites()]); // Newest first
}

function removeFavorite(date) {
    saveFavorites(getFavorites().filter((apod) => apod.date !== date));
}

// ---------- Today screen (like MainActivity.java) ----------

/** Shows one of: the picture, the loading skeleton, or the error message. */
function showOnly(view) {
    for (const v of [$("contentView"), $("loading"), $("errorView")]) {
        v.hidden = v !== view;
    }
}

async function loadPicture() {
    const request = ++requestNumber;
    currentApod = null;
    showOnly($("loading"));
    try {
        const apod = await fetchPicture(requestedDate);
        await preload(sized(imageUrlOf(apod), 1600));
        if (request === requestNumber) {
            showPicture(apod);
        }
    } catch (e) {
        if (request !== requestNumber) {
            return;
        }
        if (e instanceof NoPhotoError) {
            showNoPhoto(e.date || requestedDate || today());
        } else {
            $("textError").textContent = e.message;
            showOnly($("errorView"));
        }
    }
}

/** Waits until the image has downloaded, so it appears at once with its text. */
function preload(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = () => reject(new Error("The picture could not be downloaded. Check your connection and try again."));
        image.src = src;
    });
}

function showPicture(apod) {
    currentApod = apod;
    requestedDate = apod.date;

    $("imagePicture").src = sized(imageUrlOf(apod), 1600);
    $("imagePicture").alt = apod.title;
    $("buttonOpenOriginal").href = imageUrlOf(apod);

    let info = apod.date;
    if (apod.copyright) {
        info += "  ·  © " + apod.copyright;
    }
    $("textTitle").textContent = apod.title;
    $("textInfo").textContent = info;
    // NASA's text starts with an "Explanation:" label, which the story card already says
    $("textExplanation").textContent = apod.explanation.replace(/^\s*Explanation:\s*/i, "");

    showContent(true);
}

/** Days without a photo stay selected, so Prev / Next still work from there. */
function showNoPhoto(date) {
    requestedDate = date;
    $("textTitle").textContent = "No picture for this date";
    $("textInfo").textContent = date + "\nNo picture is available for this day. You can still browse the previous or next day.";

    showContent(false);
}

function showContent(hasPhoto) {
    $("contentView").classList.toggle("no-photo", !hasPhoto);
    showOnly($("contentView"));
    updateNavigation();
    updateFavoriteButton();
    window.scrollTo(0, 0);
}

function updateNavigation() {
    const date = requestedDate || today();
    $("textDate").textContent = "▦ " + date;
    $("inputDate").value = date;
    $("buttonPrevious").disabled = date <= FIRST_DATE;
    $("buttonNext").disabled = date >= today();
    $("buttonToday").hidden = date === today();
}

function updateFavoriteButton() {
    const saved = currentApod !== null && isFavorite(currentApod.date);
    const button = $("buttonFavorite");
    button.textContent = saved ? "♥" : "♡";
    button.setAttribute("aria-pressed", saved);
    button.setAttribute("aria-label", saved ? "Remove from favorites" : "Save");
}

function toggleFavorite() {
    if (!currentApod) {
        return;
    }
    if (isFavorite(currentApod.date)) {
        removeFavorite(currentApod.date);
        showToast("Removed from favorites");
    } else {
        addFavorite(currentApod);
        showToast("Added to favorites");
    }
    updateFavoriteButton();
}

/** Moves exactly one calendar day back (-1) or forward (+1). */
function changeDay(days) {
    const date = addDays(requestedDate || today(), days);
    if (date < FIRST_DATE || date > today()) {
        return;
    }
    openDate(date);
}

/** Loads one date ("yyyy-MM-dd"), or the latest picture for null. */
function openDate(date) {
    requestedDate = date;
    loadPicture();
}

/** Swipe left for the next day, right for the previous day. */
function listenForSwipes(element) {
    let startX = null;
    let startY = null;
    element.addEventListener("touchstart", (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    element.addEventListener("touchend", (e) => {
        if (startX === null) {
            return;
        }
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        startX = null;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
            changeDay(dx < 0 ? 1 : -1);
        }
    });
}

// ---------- Favorites screen (like FavoritesActivity.java) ----------

function refreshList() {
    const items = getFavorites();
    const list = $("listFavorites");
    list.replaceChildren();
    $("textEmpty").hidden = items.length > 0;

    for (const apod of items) {
        const card = document.createElement("li");

        const open = document.createElement("button");
        open.type = "button";
        open.className = "open";
        const thumb = document.createElement("img");
        thumb.src = sized(imageUrlOf(apod), 600);
        thumb.alt = "";
        thumb.loading = "lazy";
        const title = document.createElement("strong");
        title.textContent = apod.title;
        const date = document.createElement("span");
        date.className = "label";
        date.textContent = apod.date;
        open.append(thumb, title, date);
        open.addEventListener("click", () => {
            showScreen("today");
            showPicture(apod); // Already saved, so no need to ask NASA again
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button remove";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", "Remove " + apod.title);
        remove.addEventListener("click", () => card.append(confirmRemoval(apod)));

        card.append(open, remove);
        list.append(card);
    }
}

/** Asks on the card itself before removing a favorite. */
function confirmRemoval(apod) {
    const box = document.createElement("div");
    box.className = "confirm";
    const question = document.createElement("strong");
    question.textContent = "Remove this favorite?";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "button";
    yes.textContent = "Remove";
    yes.addEventListener("click", () => {
        removeFavorite(apod.date);
        showToast("Removed from favorites");
        refreshList();
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "button";
    no.textContent = "Cancel";
    no.addEventListener("click", () => box.remove());
    box.append(question, yes, no);
    return box;
}

// ---------- Helpers ----------

function showScreen(name) {
    const onToday = name === "today";
    $("todayScreen").hidden = !onToday;
    $("favoritesScreen").hidden = onToday;
    $("tabToday").classList.toggle("active", onToday);
    $("tabFavorites").classList.toggle("active", !onToday);
    if (onToday) {
        updateFavoriteButton(); // A favorite may have been removed
    } else {
        refreshList();
    }
    window.scrollTo(0, 0);
}

let toastTimer;
function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 2000);
}

const pad = (n) => String(n).padStart(2, "0");

/** Today's date as "yyyy-MM-dd" in the phone's time zone. */
function today() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** "yyyy-MM-dd" plus some days. Handles month/year ends and leap days. */
function addDays(date, days) {
    const [y, m, d] = date.split("-").map(Number);
    const result = new Date(Date.UTC(y, m - 1, d + days));
    return result.getUTCFullYear() + "-" + pad(result.getUTCMonth() + 1) + "-" + pad(result.getUTCDate());
}

// ---------- Start ----------

$("inputDate").max = today();
// Desktop browsers don't open the calendar when the (invisible) date box itself is clicked
$("inputDate").addEventListener("click", (e) => {
    try {
        e.target.showPicker();
    } catch (err) {
        // Older browsers, or the picker is already open
    }
});
$("inputDate").addEventListener("change", (e) => {
    if (e.target.value) {
        openDate(e.target.value);
    }
});
$("buttonPrevious").addEventListener("click", () => changeDay(-1));
$("buttonNext").addEventListener("click", () => changeDay(1));
$("buttonToday").addEventListener("click", () => openDate(null));
$("buttonFavorite").addEventListener("click", toggleFavorite);
$("buttonRetry").addEventListener("click", loadPicture);
$("buttonErrorToday").addEventListener("click", () => openDate(null));
$("tabToday").addEventListener("click", () => showScreen("today"));
$("tabFavorites").addEventListener("click", () => showScreen("favorites"));
listenForSwipes($("hero"));

loadPicture();
