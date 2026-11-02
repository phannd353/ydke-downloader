const http = require("http");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const archiver = require("archiver");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const CARD_API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const IMAGE_HOST = "https://images.ygoprodeck.com/images/cards/";
const STATIC_FILES = new Set(["/index.html", "/app.js", "/styles.css"]);

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function getCards(ids) {
  const uniqueIds = [...new Set(ids)];
  const cards = [];

  for (let index = 0; index < uniqueIds.length; index += 40) {
    const batch = uniqueIds.slice(index, index + 40);
    const response = await axios.get(CARD_API, {
      params: { id: batch.join(",") },
      timeout: 15000,
    });
    cards.push(...response.data.data);
  }

  return cards;
}

function validateIds(ids) {
  return (
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff)
  );
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function missingImageSvg(id, name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="580" viewBox="0 0 420 580"><rect width="420" height="580" rx="18" fill="#17191d"/><rect x="18" y="18" width="384" height="544" rx="12" fill="none" stroke="#e85d45" stroke-width="2"/><text x="210" y="235" fill="#e85d45" font-family="sans-serif" font-size="18" text-anchor="middle">CARD IMAGE UNAVAILABLE</text><text x="210" y="290" fill="#f1f0ed" font-family="sans-serif" font-size="24" text-anchor="middle">${escapeXml(name)}</text><text x="210" y="335" fill="#898d96" font-family="monospace" font-size="16" text-anchor="middle">ID ${id}</text></svg>`;
}

async function fetchCardImage(id, card) {
  const imageUrls = [
    ...(card?.card_images || []).map((image) => image.image_url),
    `${IMAGE_HOST}${id}.jpg`,
  ].filter((url, index, urls) => url && urls.indexOf(url) === index);

  for (const imageUrl of imageUrls) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 20000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      if (
        error.response &&
        error.response.status < 500 &&
        error.response.status !== 404
      ) {
        throw error;
      }
    }
  }
  return null;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/search") {
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2 || query.length > 80) {
      sendJson(response, 400, {
        error: "Search terms must be between 2 and 80 characters.",
      });
      return;
    }

    try {
      const result = await axios.get(CARD_API, {
        params: { fname: query, num: 24, offset: 0 },
        timeout: 15000,
      });
      const cards = (result.data.data || []).map((card) => ({
        id: card.id,
        name: card.name,
        type: card.type,
        imageUrl: card.card_images?.[0]?.image_url || null,
        imageSmallUrl: card.card_images?.[0]?.image_url_small || null,
      }));
      sendJson(response, 200, { cards });
    } catch (error) {
      if (error.response?.status === 400) {
        sendJson(response, 200, { cards: [] });
        return;
      }
      sendJson(response, 502, {
        error: "Card search is unavailable. Please try again.",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/cards") {
    const idParam = url.searchParams.get("ids") || "";
    const ids = idParam.split(",").filter(Boolean).map(Number);
    if (!validateIds(ids)) {
      sendJson(response, 400, {
        error: "Provide at least one valid card ID.",
      });
      return;
    }

    try {
      const cards = await getCards(ids);
      sendJson(response, 200, {
        cards: cards.map(({ id, name, type }) => ({ id, name, type })),
      });
    } catch (error) {
      const status = error.response?.status === 400 ? 404 : 502;
      sendJson(response, status, {
        error: "Card data could not be loaded. Check the YDKE and try again.",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deck.zip") {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
      return;
    }

    if (!validateIds(body.ids)) {
      sendJson(response, 400, {
        error: "Provide at least one valid card ID.",
      });
      return;
    }

    let cards;
    try {
      cards = await getCards(body.ids);
    } catch {
      sendJson(response, 502, {
        error:
          "Card data could not be loaded, so the download was not created.",
      });
      return;
    }

    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const archive = archiver("zip", { zlib: { level: 6 } });
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="ydke-cards.zip"',
    });
    archive.on("error", (error) => {
      console.error("Could not create card archive:", error);
      response.destroy(error);
    });
    archive.pipe(response);

    const totalCopies = new Map();
    for (const id of body.ids) {
      totalCopies.set(id, (totalCopies.get(id) || 0) + 1);
    }
    const missingImages = [];
    try {
      for (const [id, quantity] of totalCopies) {
        const card = cardsById.get(id);
        const cardName = card?.name || `Card_${id}`;
        const safeName =
          cardName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() ||
          `Card_${id}`;
        const image = await fetchCardImage(id, card);

        if (image) {
          archive.append(image, {
            name: `${quantity}/${id}_${safeName}.jpg`,
          });
        } else {
          const entryName = `${quantity}/${id}_${safeName}_image-unavailable.svg`;
          archive.append(missingImageSvg(id, cardName), { name: entryName });
          missingImages.push(entryName);
        }
      }
      if (missingImages.length) {
        archive.append(
          `Some card images were unavailable from YGOPRODeck when this archive was created. A labeled placeholder is included for each missing image.\n\n${missingImages.join("\n")}\n`,
          { name: "missing-images.txt" },
        );
      }
      await archive.finalize();
    } catch (error) {
      console.error("Could not download a card image:", error);
      response.destroy(error);
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  const url = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!STATIC_FILES.has(requestedPath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const filePath = path.resolve(ROOT, `.${requestedPath}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type":
        contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`YDKE Card Downloader is running at http://localhost:${PORT}`);
});
