# Shopify Product Export

Exports all product listings, images, collections, and metadata from the
`signfire-fine-art.myshopify.com` Shopify store into local files for use in
the new signfire.net storefront.

## Prerequisites

- **Node.js** 18+ installed
- **Shopify Admin API access token** with `read_products` and
  `read_product_listings` scopes

## Setup

1. **Create a Shopify custom app** to get an API access token:

   - Go to <https://signfire-fine-art.myshopify.com/admin/settings/apps>
   - Click **Develop apps** → **Create an app**
   - Name it something like "Product Export"
   - Under **Configuration → Admin API integration**, enable these scopes:
     - `read_products`
     - `read_product_listings`
     - `read_inventory`
   - Click **Install app**
   - Copy the **Admin API access token** (starts with `shpat_`)

2. **Configure credentials:**

   ```bash
   cd shopify-export
   cp .env.example .env
   # Edit .env and paste your access token
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

## Running the Export

**Dry run** (no files written, just shows what would be exported):

```bash
npm run export:dry-run
```

**Full export:**

```bash
npm run export
```

## Output Structure

```
shopify-export/
  data/
    products.json       # All products with variants, images, metafields
    collections.json    # All collections with product associations
    summary.json        # Export stats and product index
  images/
    <product-handle>/   # One folder per product (named by URL handle)
      1.jpg             # Images numbered by position
      2.jpg
      ...
```

## What Gets Exported

| Data                | Included in              |
|---------------------|--------------------------|
| Product title       | products.json            |
| Description (HTML)  | products.json            |
| Price & variants    | products.json            |
| SKUs                | products.json            |
| Inventory quantity  | products.json            |
| Product images      | images/ + products.json  |
| Tags                | products.json            |
| Product type        | products.json            |
| Metafields          | products.json            |
| Collections         | collections.json         |
| Product status      | products.json            |
| SEO title/desc      | products.json            |

## Re-running

The script is idempotent — images that have already been downloaded will be
skipped. You can safely re-run it at any time before the store closes on
Feb 21st to capture any changes.

## After Export

The exported `data/` and `images/` directories are git-ignored since they
contain large binary files. Keep them backed up locally. They will be used
when building the new storefront on signfire.net.
