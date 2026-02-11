#!/usr/bin/env node

/**
 * Shopify Product Export Script
 *
 * Exports all products, variants, images, collections, and metafields
 * from the Shopify store into a local directory structure.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in your credentials
 *   2. npm install
 *   3. npm run export
 *
 * Output structure:
 *   data/
 *     products.json          - All products with variants, images, metafields
 *     collections.json       - All collections and their product associations
 *     summary.json           - Export metadata and stats
 *   images/
 *     <product-handle>/      - One folder per product
 *       1.jpg                - Product images numbered by position
 *       2.jpg
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Load .env file manually (no extra dependency needed)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContents = fs.readFileSync(envPath, "utf-8");
  for (const line of envContents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const STORE = process.env.SHOPIFY_STORE;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "true";
const API_VERSION = "2024-10";

const DATA_DIR = path.join(__dirname, "data");
const IMAGE_DIR = path.join(__dirname, "images");

if (!STORE || !ACCESS_TOKEN) {
  console.error(
    "Error: SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN must be set.\n" +
      "Copy .env.example to .env and fill in your credentials."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function shopifyGet(endpoint) {
  const url = `https://${STORE}/admin/api/${API_VERSION}${endpoint}`;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "X-Shopify-Access-Token": ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 429) {
            // Rate limited — wait and retry
            const retryAfter = parseFloat(res.headers["retry-after"] || "2");
            console.log(`  Rate limited, waiting ${retryAfter}s...`);
            setTimeout(() => {
              shopifyGet(endpoint).then(resolve).catch(reject);
            }, retryAfter * 1000);
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                `Shopify API error ${res.statusCode} for ${endpoint}: ${body}`
              )
            );
            return;
          }
          try {
            const data = JSON.parse(body);
            // Extract Link header for pagination
            const linkHeader = res.headers["link"] || "";
            resolve({ data, linkHeader });
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${endpoint}: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
  });
}

/**
 * Paginate through a Shopify REST endpoint that supports cursor-based pagination.
 */
async function shopifyGetAll(endpoint, rootKey) {
  const allItems = [];
  let url = endpoint.includes("?")
    ? `${endpoint}&limit=250`
    : `${endpoint}?limit=250`;

  while (url) {
    const { data, linkHeader } = await shopifyGet(url);
    const items = data[rootKey] || [];
    allItems.push(...items);
    console.log(`  Fetched ${allItems.length} ${rootKey} so far...`);

    // Parse next page from Link header
    url = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<https:\/\/[^/]+\/admin\/api\/[^/]+([^>]+)>;\s*rel="next"/
      );
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }
  return allItems;
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? https : http;
    const req = getter.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`Download failed (${res.statusCode}): ${url}`));
        return;
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      fileStream.on("error", reject);
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

async function exportProducts() {
  console.log("\n--- Fetching products ---");
  const products = await shopifyGetAll("/products.json", "products");

  // Fetch metafields for each product
  console.log("\n--- Fetching product metafields ---");
  for (const product of products) {
    try {
      const { data } = await shopifyGet(
        `/products/${product.id}/metafields.json?limit=250`
      );
      product.metafields = data.metafields || [];
    } catch (e) {
      console.warn(
        `  Warning: Could not fetch metafields for product ${product.id}: ${e.message}`
      );
      product.metafields = [];
    }
  }

  return products;
}

async function exportCollections() {
  console.log("\n--- Fetching custom collections ---");
  const customCollections = await shopifyGetAll(
    "/custom_collections.json",
    "custom_collections"
  );

  console.log("\n--- Fetching smart collections ---");
  const smartCollections = await shopifyGetAll(
    "/smart_collections.json",
    "smart_collections"
  );

  const allCollections = [
    ...customCollections.map((c) => ({ ...c, type: "custom" })),
    ...smartCollections.map((c) => ({ ...c, type: "smart" })),
  ];

  // Fetch products (collects) for each custom collection
  console.log("\n--- Fetching collection-product associations ---");
  const collects = await shopifyGetAll("/collects.json", "collects");

  // Attach product IDs to collections
  for (const collection of allCollections) {
    collection.product_ids = collects
      .filter((c) => c.collection_id === collection.id)
      .map((c) => c.product_id);
  }

  return allCollections;
}

async function downloadProductImages(products) {
  console.log("\n--- Downloading product images ---");
  let totalImages = 0;
  let downloaded = 0;
  let skipped = 0;

  for (const product of products) {
    if (!product.images || product.images.length === 0) continue;

    const handle = product.handle || `product-${product.id}`;
    const productImageDir = path.join(IMAGE_DIR, handle);

    if (!DRY_RUN) {
      fs.mkdirSync(productImageDir, { recursive: true });
    }

    for (const image of product.images) {
      totalImages++;
      const ext = getExtension(image.src);
      const filename = `${image.position}${ext}`;
      const destPath = path.join(productImageDir, filename);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would download: ${handle}/${filename}`);
        skipped++;
        continue;
      }

      // Skip if already downloaded
      if (fs.existsSync(destPath)) {
        skipped++;
        continue;
      }

      try {
        await downloadFile(image.src, destPath);
        downloaded++;
        process.stdout.write(
          `\r  Downloaded ${downloaded} images (${skipped} skipped)...`
        );
      } catch (e) {
        console.warn(`\n  Warning: Failed to download ${image.src}: ${e.message}`);
      }
    }
  }

  console.log(
    `\n  Total: ${totalImages} images, ${downloaded} downloaded, ${skipped} skipped`
  );
  return { totalImages, downloaded, skipped };
}

function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).split("?")[0];
    return ext || ".jpg";
  } catch {
    return ".jpg";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Shopify Product Export ===");
  console.log(`Store: ${STORE}`);
  console.log(`API Version: ${API_VERSION}`);
  if (DRY_RUN) console.log("MODE: DRY RUN (no files will be written)\n");

  // Create directories
  if (!DRY_RUN) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  // Export products
  const products = await exportProducts();
  console.log(`\nTotal products: ${products.length}`);

  // Export collections
  const collections = await exportCollections();
  console.log(`Total collections: ${collections.length}`);

  // Write JSON data
  if (!DRY_RUN) {
    fs.writeFileSync(
      path.join(DATA_DIR, "products.json"),
      JSON.stringify(products, null, 2)
    );
    console.log("\nWrote data/products.json");

    fs.writeFileSync(
      path.join(DATA_DIR, "collections.json"),
      JSON.stringify(collections, null, 2)
    );
    console.log("Wrote data/collections.json");
  }

  // Download images
  const imageStats = await downloadProductImages(products);

  // Write summary
  const summary = {
    exportDate: new Date().toISOString(),
    store: STORE,
    apiVersion: API_VERSION,
    stats: {
      totalProducts: products.length,
      totalVariants: products.reduce(
        (sum, p) => sum + (p.variants ? p.variants.length : 0),
        0
      ),
      totalImages: imageStats.totalImages,
      imagesDownloaded: imageStats.downloaded,
      totalCollections: collections.length,
    },
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      variants: (p.variants || []).length,
      images: (p.images || []).length,
      metafields: (p.metafields || []).length,
    })),
  };

  if (!DRY_RUN) {
    fs.writeFileSync(
      path.join(DATA_DIR, "summary.json"),
      JSON.stringify(summary, null, 2)
    );
    console.log("Wrote data/summary.json");
  }

  console.log("\n=== Export Complete ===");
  console.log(`Products: ${summary.stats.totalProducts}`);
  console.log(`Variants: ${summary.stats.totalVariants}`);
  console.log(`Images: ${summary.stats.totalImages}`);
  console.log(`Collections: ${summary.stats.totalCollections}`);

  if (DRY_RUN) {
    console.log("\nThis was a dry run. Run `npm run export` to perform the actual export.");
  }
}

main().catch((err) => {
  console.error("\nExport failed:", err.message);
  process.exit(1);
});
