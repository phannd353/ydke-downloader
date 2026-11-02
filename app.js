const form = document.getElementById("deck-form");
const input = document.getElementById("ydke-input");
const message = document.getElementById("message");
const loadButton = document.getElementById("load-button");
const deckSection = document.getElementById("deck-section");
const deckGroups = document.getElementById("deck-groups");
const deckCount = document.getElementById("deck-count");
const downloadButton = document.getElementById("download-button");

let deckIds = [];
const sections = ["Main Deck", "Extra Deck", "Side Deck"];

function decodeSection(value, sectionName) {
  if (!value) return [];

  let encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
  let binary;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error(`${sectionName} contains invalid YDKE data.`);
  }

  if (binary.length % 4 !== 0) {
    throw new Error(`${sectionName} data is incomplete.`);
  }

  const ids = [];
  for (let index = 0; index < binary.length; index += 4) {
    const id =
      (binary.charCodeAt(index) |
        (binary.charCodeAt(index + 1) << 8) |
        (binary.charCodeAt(index + 2) << 16) |
        (binary.charCodeAt(index + 3) << 24)) >>>
      0;
    if (!id) throw new Error(`${sectionName} contains an invalid card ID.`);
    ids.push(id);
  }
  return ids;
}

function parseYdke(value) {
  const trimmed = value.trim();
  if (!/^ydke:\/\//i.test(trimmed)) {
    throw new Error("Paste a YDKE link starting with ydke://.");
  }
  const parts = trimmed.slice(trimmed.indexOf("//") + 2).split("!");
  if (parts.length !== 4 || parts[3] !== "") {
    throw new Error("YDKE links must include Main, Extra, and Side sections.");
  }

  const groups = parts
    .slice(0, 3)
    .map((part, index) => decodeSection(part, sections[index]));
  const ids = groups.flat();
  if (!ids.length)
    throw new Error("This YDKE link does not contain any cards.");
  if (ids.length > 150)
    throw new Error("This deck has more than 150 cards; the limit is 150.");
  return groups;
}

function makeCard(card, quantity) {
  const article = document.createElement("article");
  article.className = "card";

  const imageFrame = document.createElement("div");
  imageFrame.className = "card-image";
  const image = document.createElement("img");
  image.src = `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`;
  image.alt = card.name;
  image.loading = "lazy";
  image.onerror = () => {
    image.remove();
    const fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.textContent = `#${card.id}`;
    imageFrame.append(fallback);
  };
  imageFrame.append(image);

  if (quantity > 1) {
    const badge = document.createElement("span");
    badge.className = "quantity";
    badge.textContent = `×${quantity}`;
    imageFrame.append(badge);
  }

  const caption = document.createElement("div");
  caption.className = "card-caption";
  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = card.name;
  name.title = card.name;
  const type = document.createElement("div");
  type.className = "card-type";
  type.textContent = card.type;
  caption.append(name, type);
  article.append(imageFrame, caption);
  return article;
}

function renderGroup(title, ids, cardsById) {
  const group = document.createElement("section");
  group.className = "deck-group";
  const heading = document.createElement("div");
  heading.className = "group-heading";
  const label = document.createElement("h3");
  label.textContent = title;
  const count = document.createElement("span");
  count.textContent = `${ids.length} cards`;
  heading.append(label, count);
  group.append(heading);

  const grid = document.createElement("div");
  grid.className = "card-grid";
  const quantities = new Map();
  for (const id of ids) quantities.set(id, (quantities.get(id) || 0) + 1);
  const rendered = new Set();
  for (const id of ids) {
    if (rendered.has(id)) continue;
    rendered.add(id);
    const card = cardsById.get(id);
    if (card) grid.append(makeCard(card, quantities.get(id)));
  }
  group.append(grid);
  return group;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  loadButton.disabled = true;
  loadButton.querySelector("span:first-child").textContent = "Loading cards…";
  deckSection.hidden = true;

  try {
    const groups = parseYdke(input.value);
    const ids = groups.flat();
    const response = await fetch(
      `/api/cards?ids=${encodeURIComponent([...new Set(ids)].join(","))}`,
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not load card data.");

    const cardsById = new Map(result.cards.map((card) => [card.id, card]));
    for (const id of new Set(ids)) {
      if (!cardsById.has(id)) {
        cardsById.set(id, {
          id,
          name: `Card #${id}`,
          type: "Card details unavailable",
        });
      }
    }

    deckIds = ids;
    deckCount.textContent = `${ids.length} cards`;
    deckGroups.replaceChildren(
      ...groups.map((group, index) =>
        renderGroup(sections[index], group, cardsById),
      ),
    );
    deckSection.hidden = false;
    deckSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    message.textContent =
      error.message || "Something went wrong while loading this deck.";
  } finally {
    loadButton.disabled = false;
    loadButton.querySelector("span:first-child").textContent = "Show my deck";
  }
});

downloadButton.addEventListener("click", async () => {
  console.log("Requesting ZIP for card IDs:", deckIds);
  if (!deckIds.length) return;
  message.textContent = "";
  downloadButton.disabled = true;
  downloadButton.querySelector("strong").textContent = "Preparing ZIP…";

  try {
    const response = await fetch("/api/deck.zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: deckIds }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Could not create the card download.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = "ydke-cards.zip";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    message.textContent =
      error.message || "Could not download the cards. Please try again.";
  } finally {
    downloadButton.disabled = false;
    downloadButton.querySelector("strong").textContent = "Download all";
  }
});
