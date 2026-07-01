# Shopify Product Export

Exports all product listings, images, and metadata from the
`signfire-fine-art.myshopify.com` Shopify store into local files for use in
the new signfire.net storefront.

## Prerequisites

- **Node.js** 18+ installed
- No API token required — uses Shopify's public storefront JSON endpoint

## Running the Export

**Dry run** (no files written, just shows what would be exported):

```bash
cd shopify-export
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
    products.json       # All products with variants and images
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
| Product images      | images/ + products.json  |
| Tags                | products.json            |
| Product type        | products.json            |

## Re-running

The script is idempotent — images that have already been downloaded will be
skipped. You can safely re-run it at any time before the store closes on
Feb 21st to capture any changes.

## After Export

The exported `data/` and `images/` directories are git-ignored since they
contain large binary files. Keep them backed up locally. They will be used
when building the new storefront on signfire.net.
