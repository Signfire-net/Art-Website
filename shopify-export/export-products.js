#!/usr/bin/env node

/**
 * Shopify Product Export Script
 *
 * Exports all products, variants, and images from the Shopify store
 * using the PUBLIC storefront JSON endpoint (no API token needed).
 *
 * Usage:
 *   npm run export           # Full export (downloads images)
 *   npm run export:dry-run   # Show what would be exported without downloading
 *
 * Output structure:
 *   data/
 *     products.json          - All products with variants and images
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

const STORE = "signfire-fine-art.myshopify.com";
const DRY_RUN = process.env.DRY_RUN === "true";

const DATA_DIR = path.join(__dirname, "data");
const IMAGE_DIR = path.join(__dirname, "images");

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? https : http;
    const req = getter.get(url, (res) => {
      // Follow redirects
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? https : http;
    const req = getter.get(url, (res) => {
      // Follow redirects
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
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
// Export functions
// ---------------------------------------------------------------------------

async function fetchProducts() {
  console.log("\n--- Fetching products via public storefront API ---");

  const allProducts = [];
  let page = 1;

  while (true) {
    const url = `https://${STORE}/products.json?limit=250&page=${page}`;
    console.log(`  Fetching page ${page}...`);
    const data = await fetchJSON(url);
    const products = data.products || [];

    if (products.length === 0) break;

    allProducts.push(...products);
    console.log(`  Got ${products.length} products (total: ${allProducts.length})`);

    if (products.length < 250) break;
    page++;
  }

  return allProducts;
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
        console.warn(
          `\n  Warning: Failed to download ${image.src}: ${e.message}`
        );
      }
    }
  }

  console.log(
    `\n  Total: ${totalImages} images, ${downloaded} downloaded, ${skipped} skipped`
  );
  return { totalImages, downloaded, skipped };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Shopify Product Export ===");
  console.log(`Store: ${STORE}`);
  console.log("Source: Public storefront API (no token required)");
  if (DRY_RUN) console.log("MODE: DRY RUN (no files will be written)\n");

  // Create directories
  if (!DRY_RUN) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  // Fetch products
  const products = await fetchProducts();
  console.log(`\nTotal products: ${products.length}`);

  // Write product JSON
  if (!DRY_RUN) {
    fs.writeFileSync(
      path.join(DATA_DIR, "products.json"),
      JSON.stringify({ products }, null, 2)
    );
    console.log("\nWrote data/products.json");
  }

  // Download images
  const imageStats = await downloadProductImages(products);

  // Write summary
  const summary = {
    exportDate: new Date().toISOString(),
    store: STORE,
    source: "public-storefront-api",
    stats: {
      totalProducts: products.length,
      totalVariants: products.reduce(
        (sum, p) => sum + (p.variants ? p.variants.length : 0),
        0
      ),
      totalImages: imageStats.totalImages,
      imagesDownloaded: imageStats.downloaded,
    },
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      variants: (p.variants || []).length,
      images: (p.images || []).length,
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

  if (DRY_RUN) {
    console.log(
      "\nThis was a dry run. Run `npm run export` to perform the actual export."
    );
  }
}

main().catch((err) => {
  console.error("\nExport failed:", err.message);
  process.exit(1);
});
