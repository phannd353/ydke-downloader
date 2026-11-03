const form = document.getElementById("deck-form");
const input = document.getElementById("ydke-input");
const message = document.getElementById("message");
const loadButton = document.getElementById("load-button");
const mergeButton = document.getElementById("merge-button");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const addTarget = document.getElementById("add-target");
const deckGroups = document.getElementById("deck-groups");
const deckCount = document.getElementById("deck-count");
const exportButton = document.getElementById("export-button");
const pdfButton = document.getElementById("pdf-button");
const downloadButton = document.getElementById("download-button");
const cardPreview = document.getElementById("card-preview");
const cardPreviewImage = cardPreview.querySelector(".card-preview-image");
const cardPreviewName = cardPreview.querySelector(".card-preview-name");
const cardPreviewType = cardPreview.querySelector(".card-preview-type");

const sections = [
  { key: "main", title: "Main Deck" },
  { key: "extra", title: "Extra Deck" },
  { key: "side", title: "Side Deck" },
];
const deck = { main: [], extra: [], side: [] };
const cardsById = new Map();
let searchTimer;
let searchController;

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
    .map((part, index) => decodeSection(part, sections[index].title));
  const ids = groups.flat();
  if (!ids.length) throw new Error("This YDKE link does not contain any cards.");
  return groups;
}

function allDeckIds() {
  return sections.flatMap(({ key }) => deck[key]);
}

function renderCardImage(frame, card) {
  const image = document.createElement("img");
  image.src =
    card.imageUrl ||
    `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`;
  image.alt = card.name;
  image.loading = "lazy";
  image.onerror = () => {
    image.remove();
    const fallback = document.createElement("span");
    fallback.className = "image-fallback";
    fallback.textContent = `#${card.id}`;
    frame.append(fallback);
  };
  frame.append(image);
}

function showCardPreview(card) {
  cardPreviewImage.src =
    card.imageUrl ||
    `https://images.ygoprodeck.com/images/cards/${card.id}.jpg`;
  cardPreviewImage.alt = card.name;
  cardPreviewName.textContent = card.name;
  cardPreviewType.textContent = card.type || "Card";
  cardPreview.showModal();
}

function renderDeckCard(card, quantity, sectionKey) {
  const article = document.createElement("article");
  article.className = "card deck-card";
  const previewButton = document.createElement("button");
  previewButton.className = "deck-card-preview";
  previewButton.type = "button";
  previewButton.setAttribute("aria-label", `Preview ${card.name}`);
  previewButton.addEventListener("click", () => showCardPreview(card));
  const imageFrame = document.createElement("div");
  imageFrame.className = "card-image";
  renderCardImage(imageFrame, card);

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
  type.textContent = card.type || "Card";
  caption.append(name, type);
  previewButton.append(imageFrame, caption);

  const quantityControls = document.createElement("div");
  quantityControls.className = "quantity-controls";
  const decrease = document.createElement("button");
  decrease.className = "quantity-button";
  decrease.type = "button";
  decrease.textContent = "−";
  decrease.setAttribute("aria-label", `Remove one ${card.name} from the deck`);
  decrease.addEventListener("click", () => {
    const index = deck[sectionKey].lastIndexOf(card.id);
    if (index !== -1) deck[sectionKey].splice(index, 1);
    renderDeck();
  });
  const quantityInput = document.createElement("input");
  quantityInput.className = "quantity-input";
  quantityInput.type = "number";
  quantityInput.min = "0";
  quantityInput.step = "1";
  quantityInput.value = quantity;
  quantityInput.setAttribute("aria-label", `Quantity of ${card.name}`);
  quantityInput.title = "Set quantity; enter 0 to remove this card";
  quantityInput.addEventListener("change", () => {
    const nextQuantity = quantityInput.valueAsNumber;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) {
      quantityInput.value = quantity;
      return;
    }

    const cardIds = deck[sectionKey];
    let currentQuantity = 0;
    for (const id of cardIds) {
      if (id === card.id) currentQuantity += 1;
    }
    if (nextQuantity < currentQuantity) {
      let removeCount = currentQuantity - nextQuantity;
      for (
        let index = cardIds.length - 1;
        index >= 0 && removeCount;
        index -= 1
      ) {
        if (cardIds[index] === card.id) {
          cardIds.splice(index, 1);
          removeCount -= 1;
        }
      }
    } else {
      for (let count = currentQuantity; count < nextQuantity; count += 1) {
        cardIds.push(card.id);
      }
    }
    renderDeck();
  });
  const increase = document.createElement("button");
  increase.className = "quantity-button";
  increase.type = "button";
  increase.textContent = "+";
  increase.setAttribute("aria-label", `Add one ${card.name} to the deck`);
  increase.addEventListener("click", () => {
    deck[sectionKey].push(card.id);
    renderDeck();
  });
  quantityControls.append(decrease, quantityInput, increase);
  article.append(previewButton, quantityControls);
  return article;
}

function renderDeck() {
  const ids = allDeckIds();
  deckCount.textContent = `${ids.length} ${ids.length === 1 ? "card" : "cards"}`;
  exportButton.disabled = ids.length === 0;
  pdfButton.disabled = ids.length === 0;
  downloadButton.disabled = ids.length === 0;
  document.querySelector(".empty-deck").hidden = ids.length !== 0;

  deckGroups.replaceChildren(
    ...sections.map(({ key, title }) => {
      const group = document.createElement("section");
      group.className = "deck-group";
      const heading = document.createElement("div");
      heading.className = "group-heading";
      const label = document.createElement("h3");
      label.textContent = title;
      const count = document.createElement("span");
      const groupIds = deck[key];
      count.textContent = `${groupIds.length} ${groupIds.length === 1 ? "card" : "cards"}`;
      heading.append(label, count);

      const grid = document.createElement("div");
      grid.className = "card-grid";
      const quantities = new Map();
      for (const id of groupIds) {
        quantities.set(id, (quantities.get(id) || 0) + 1);
      }
      const rendered = new Set();
      for (const id of groupIds) {
        if (rendered.has(id)) continue;
        rendered.add(id);
        const card = cardsById.get(id) || {
          id,
          name: `Card #${id}`,
          type: "Card details unavailable",
        };
        grid.append(renderDeckCard(card, quantities.get(id), key));
      }
      group.append(heading, grid);
      return group;
    }),
  );
}

function addCard(card) {
  const target = addTarget.value;
  cardsById.set(card.id, card);
  deck[target].push(card.id);
  renderDeck();
  searchStatus.textContent = `Added ${card.name} to ${sections.find((section) => section.key === target).title}.`;
}

function renderSearchResults(cards) {
  searchResults.replaceChildren();
  for (const card of cards) {
    cardsById.set(card.id, card);
    const result = document.createElement("article");
    result.className = "search-result";
    const previewButton = document.createElement("button");
    previewButton.className = "search-preview-button";
    previewButton.type = "button";
    previewButton.setAttribute("aria-label", `Preview ${card.name}`);
    previewButton.addEventListener("click", () => showCardPreview(card));
    const imageFrame = document.createElement("div");
    imageFrame.className = "search-card-image";
    renderCardImage(imageFrame, {
      ...card,
      imageUrl: card.imageSmallUrl || card.imageUrl,
    });

    const details = document.createElement("div");
    details.className = "search-card-details";
    const name = document.createElement("strong");
    name.textContent = card.name;
    const type = document.createElement("span");
    type.textContent = card.type || "Card";
    details.append(name, type);
    previewButton.append(imageFrame, details);

    const addButton = document.createElement("button");
    addButton.className = "add-card-button";
    addButton.type = "button";
    addButton.textContent = "Add";
    addButton.setAttribute("aria-label", `Add ${card.name} to selected deck`);
    addButton.addEventListener("click", () => addCard(card));
    result.append(previewButton, addButton);
    searchResults.append(result);
  }
}

cardPreview.querySelector(".card-preview-close").addEventListener("click", () => {
  cardPreview.close();
});
cardPreview.addEventListener("click", (event) => {
  if (event.target === cardPreview) cardPreview.close();
});

async function searchCards(query) {
  searchController?.abort();
  searchController = new AbortController();
  searchStatus.textContent = "Searching YGOPRODeck…";
  searchResults.replaceChildren();
  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(query)}`,
      { signal: searchController.signal },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not search cards.");
    renderSearchResults(result.cards);
    searchStatus.textContent = result.cards.length
      ? `${result.cards.length} cards found.`
      : "No cards found. Try a different name.";
  } catch (error) {
    if (error.name === "AbortError") return;
    searchStatus.textContent =
      error.message || "Card search is unavailable. Please try again.";
  }
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  searchController?.abort();
  if (query.length < 2) {
    searchResults.replaceChildren();
    searchStatus.textContent = "Enter at least 2 characters to search.";
    return;
  }
  searchTimer = setTimeout(() => searchCards(query), 300);
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length >= 2) searchCards(query);
});

async function importDeck(merge) {
  message.textContent = "";
  loadButton.disabled = true;
  mergeButton.disabled = true;
  loadButton.querySelector("span:first-child").textContent = "Loading cards…";
  mergeButton.textContent = "Loading cards…";

  try {
    const groups = parseYdke(input.value);
    const ids = groups.flat();
    const response = await fetch(
      `/api/cards?ids=${encodeURIComponent([...new Set(ids)].join(","))}`,
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Could not load card data.");
    }

    const importedCards = new Map(
      result.cards.map((card) => [card.id, card]),
    );
    for (const id of new Set(ids)) {
      cardsById.set(
        id,
        importedCards.get(id) || {
          id,
          name: `Card #${id}`,
          type: "Card details unavailable",
        },
      );
    }
    sections.forEach(({ key }, index) => {
      deck[key] = merge ? [...deck[key], ...groups[index]] : groups[index];
    });
    renderDeck();
    if (merge) message.textContent = "Merged YDKE cards into the existing deck.";
    document.querySelector(".editor-panel").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  } catch (error) {
    message.textContent =
      error.message || "Something went wrong while loading this deck.";
  } finally {
    loadButton.disabled = false;
    mergeButton.disabled = false;
    loadButton.querySelector("span:first-child").textContent = "Load deck";
    mergeButton.textContent = "Merge YDKE";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  importDeck(false);
});

mergeButton.addEventListener("click", () => importDeck(true));

function encodeSection(ids) {
  let binary = "";
  for (const id of ids) {
    binary += String.fromCharCode(
      id & 0xff,
      (id >>> 8) & 0xff,
      (id >>> 16) & 0xff,
      (id >>> 24) & 0xff,
    );
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

exportButton.addEventListener("click", async () => {
  const link = `ydke://${sections.map(({ key }) => encodeSection(deck[key])).join("!") }!`;
  try {
    await navigator.clipboard.writeText(link);
    message.textContent = "YDKE link copied to clipboard.";
  } catch {
    message.textContent = "Could not copy the YDKE link. Check clipboard permissions.";
  }
});

pdfButton.addEventListener("click", () => {
  const ids = allDeckIds();
  if (!ids.length) return;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    message.textContent =
      "Could not open the PDF export. Allow pop-ups and try again.";
    return;
  }

  const printDocument = printWindow.document;
  printDocument.open();
  printDocument.write(
    '<!doctype html><html><head><meta charset="utf-8"><title>YDKE cards</title></head><body></body></html>',
  );
  printDocument.close();

  const style = printDocument.createElement("style");
  style.textContent = `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    .sheet {
      width: 210mm;
      height: 297mm;
      display: grid;
      grid-template-columns: repeat(3, 59mm);
      grid-template-rows: repeat(3, 86mm);
      gap: 0;
      place-content: center;
      break-after: page;
      page-break-after: always;
    }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
    .card-slot { width: 59mm; height: 86mm; overflow: hidden; }
    .card-slot img { display: block; width: 100%; height: 100%; }
    .card-placeholder {
      display: grid;
      width: 100%;
      height: 100%;
      place-content: center;
      border: 1px solid #999;
      color: #555;
      font: 10pt sans-serif;
      text-align: center;
    }
    @media print {
      html, body { width: 210mm; }
      .sheet { margin: 0; }
    }
  `;
  printDocument.head.append(style);

  const imagePromises = [];
  for (let offset = 0; offset < ids.length; offset += 9) {
    const sheet = printDocument.createElement("main");
    sheet.className = "sheet";
    for (const id of ids.slice(offset, offset + 9)) {
      const slot = printDocument.createElement("div");
      slot.className = "card-slot";
      const image = printDocument.createElement("img");
      image.alt = `Card ${id}`;
      slot.append(image);
      imagePromises.push(
        new Promise((resolve) => {
          let settled = false;
          const finish = (loaded) => {
            if (settled) return;
            settled = true;
            if (!loaded) {
              const placeholder = printDocument.createElement("div");
              placeholder.className = "card-placeholder";
              placeholder.textContent = `Image unavailable\\nCard ${id}`;
              slot.replaceChildren(placeholder);
            }
            resolve();
          };
          image.onload = () => finish(true);
          image.onerror = () => finish(false);
          image.src = `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
          if (image.complete) finish(image.naturalWidth > 0);
        }),
      );
      sheet.append(slot);
    }
    for (let count = Math.min(9, ids.length - offset); count < 9; count += 1) {
      const blankSlot = printDocument.createElement("div");
      blankSlot.className = "card-slot";
      sheet.append(blankSlot);
    }
    printDocument.body.append(sheet);
  }

  message.textContent = "Preparing A4 pages with 9 cards per page…";
  Promise.all(imagePromises).then(() => {
    printWindow.focus();
    printWindow.print();
    message.textContent = "Choose Save to PDF in the print dialog.";
  });
});

downloadButton.addEventListener("click", async () => {
  const ids = allDeckIds();
  if (!ids.length) return;
  message.textContent = "";
  downloadButton.disabled = true;
  downloadButton.querySelector("strong").textContent = "Preparing ZIP…";

  try {
    const response = await fetch("/api/deck.zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
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
    downloadButton.disabled = allDeckIds().length === 0;
    downloadButton.querySelector("strong").textContent = "Download all";
  }
});

renderDeck();
