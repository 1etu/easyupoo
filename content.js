/**
 * @license
 * easyupoo - A Chrome extension for easy price tracking
 * https://github.com/1etu/easyupoo
 * 
 * Copyright (c) 2024 1etu (github.com/1etu)
 * Licensed under the MIT license.
 * 
 * This extension is provided as-is without any warranty.
 * Use at your own risk.
 * 
 * Rules:
 * 1. Do not use this extension for commercial purposes
 * 2. Do not distribute modified versions without proper attribution
 * 3. Include this license and copyright notice in all copies
 * 4. Report bugs and issues on GitHub
 */

const DEBUG = false; // Don't turn this on If you don't know what you're doing

const PLATFORM_CONFIG = {
  preferredPlatform: 'weidian', // 'taobao' or 'weidian'
  platforms: {
    taobao: {
      baseUrl: 'https://www.jadeship.com/item/taobao/',
      priority: 1
    },
    weidian: {
      baseUrl: 'https://www.jadeship.com/item/weidian/',
      priority: 2
    }
  }
};

// Don't touch this
const CACHE_CONFIG = {
  version: '1.0.0',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  maxItems: 1000,
};

/**
 * A persistent caching system for Chrome extension that stores data in chrome.storage.local
 * with automatic cleanup and version control.
 * 
 * @class PersistentCache
 * @description Implements a Map-based caching system that persists data to chrome.storage.local.
 * Features include:
 * - Automatic initialization and data loading
 * - Version-based cache invalidation
 * - Automatic cleanup of expired entries
 * - Size-based cache eviction (LRU)
 * - Timestamp-based entry validation
 * 
 * @requires chrome.storage
 * @requires CACHE_CONFIG Configuration object containing version, maxAge, and maxItems
 * @requires DEBUG Boolean flag for debug logging
 * 
 * @example
 * const cache = new PersistentCache();
 * await cache.set('key', 'value');
 * const value = await cache.get('key');
 * 
 * @property {Map} data - Internal storage for cache entries
 * @property {boolean} initialized - Flag indicating if cache is initialized
 * @property {Promise} initPromise - Promise that resolves when initialization is complete
 */
class PersistentCache {
  constructor() {
    this.data = new Map();
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      const metadata = await chrome.storage.local.get('cacheMetadata');
      const currentMetadata = metadata.cacheMetadata || {
        version: CACHE_CONFIG.version,
        lastCleanup: Date.now(),
      };

      if (currentMetadata.version !== CACHE_CONFIG.version) {
        await this.clearCache();
        currentMetadata.version = CACHE_CONFIG.version;
      }

      const result = await chrome.storage.local.get('productCache');
      if (result.productCache) {
        const storedCache = new Map(Object.entries(result.productCache));
        
        for (const [key, value] of storedCache) {
          if (this.isValidCacheEntry(value)) {
            this.data.set(key, value);
          }
        }
      }

      if (Date.now() - currentMetadata.lastCleanup > 24 * 60 * 60 * 1000) {
        await this.cleanup();
        currentMetadata.lastCleanup = Date.now();
      }

      await chrome.storage.local.set({ cacheMetadata: currentMetadata });
      
      this.initialized = true;
      if (DEBUG) {
        console.log('Cache initialized with', this.data.size, 'valid items');
      }
    } catch (error) {
      console.error('Cache initialization error:', error);
      this.initialized = true;
    }
  }

  isValidCacheEntry(entry) {
    return entry &&
           entry.timestamp &&
           Date.now() - entry.timestamp < CACHE_CONFIG.maxAge &&
           entry.data;
  }

  async waitForInitialization() {
    await this.initPromise;
  }

  async get(key) {
    await this.waitForInitialization();
    
    const entry = this.data.get(key);
    if (entry && this.isValidCacheEntry(entry)) {
      entry.lastAccessed = Date.now();
      return entry.data;
    }
    return null;
  }

  async set(key, value) {
    await this.waitForInitialization();

    const entry = {
      data: value,
      timestamp: Date.now(),
      lastAccessed: Date.now()
    };

    this.data.set(key, entry);
    await this.persistToStorage();
  }

  async persistToStorage() {
    try {
      const cacheObject = Object.fromEntries(this.data);
      await chrome.storage.local.set({ productCache: cacheObject });
    } catch (error) {
      console.error('Cache persistence error:', error);
    }
  }

  async cleanup() {
    const now = Date.now();
    let deleted = 0;

    for (const [key, entry] of this.data) {
      if (!this.isValidCacheEntry(entry)) {
        this.data.delete(key);
        deleted++;
      }
    }

    if (this.data.size > CACHE_CONFIG.maxItems) {
      const sortedEntries = Array.from(this.data.entries())
        .sort((a, b) => b[1].lastAccessed - a[1].lastAccessed);

      while (this.data.size > CACHE_CONFIG.maxItems) {
        const [keyToDelete] = sortedEntries.pop();
        this.data.delete(keyToDelete);
        deleted++;
      }
    }

    if (deleted > 0) {
      await this.persistToStorage();
      if (DEBUG) {
        console.log(`Cleaned up ${deleted} cache entries`);
      }
    }
  }

  async clearCache() {
    this.data.clear();
    await chrome.storage.local.remove(['productCache', 'cacheMetadata']);
    if (DEBUG) {
      console.log('Cache cleared');
    }
  }
}

// --- START DON'T TOUCH ---
const productCache = new PersistentCache();


function initializeUI() {
  document.body.style.backgroundColor = "#f0f8ff";
  if (DEBUG) {
    const banner = document.createElement("div");
    banner.textContent = "Debug Mode";
    banner.style.position = "fixed";
    banner.style.top = "0";
    banner.style.left = "0";
    banner.style.width = "100%";
    banner.style.backgroundColor = "#ff9800";
    banner.style.color = "#fff";
    banner.style.textAlign = "center";
    banner.style.padding = "10px 0";
    banner.style.zIndex = "9999";
    document.body.appendChild(banner);
  }
}

function createPriceBadge() {
  const container = document.createElement('span');
  container.style.display = 'inline-flex';
  container.style.alignItems = 'center';
  container.style.gap = '8px';
  
  const badge = document.createElement('span');
  badge.style.backgroundColor = '#2e7d32';
  badge.style.color = '#ffffff';
  badge.style.padding = '1px 4px';
  badge.style.borderRadius = '2px';
  badge.style.fontSize = '0.9em';
  badge.style.fontWeight = '400';
  badge.style.opacity = '0';
  badge.style.transition = 'opacity 0.3s ease';
  badge.textContent = 'Loading...';

  const retryButton = document.createElement('span');
  retryButton.style.backgroundColor = '#ff9800';
  retryButton.style.color = '#ffffff';
  retryButton.style.padding = '1px 4px';
  retryButton.style.borderRadius = '2px';
  retryButton.style.fontSize = '0.9em';
  retryButton.style.fontWeight = '400';
  retryButton.style.opacity = '0';
  retryButton.style.transition = 'opacity 0.3s ease';
  retryButton.style.cursor = 'pointer';
  retryButton.textContent = 'Try Again';
  retryButton.style.display = 'none';

  container.appendChild(badge);
  container.appendChild(retryButton);
  return { container, badge, retryButton };
}
// --- END OF DON'T TOUCH ---

/**
 * Determines which platform's price to use based on configuration and availability.
 * @param {Object} prices - Object containing prices from different platforms
 * @returns {Object} Selected platform price and details
 */
function selectPlatformPrice(prices) {
  const { platforms } = PLATFORM_CONFIG;
  
  const availablePrices = Object.entries(prices)
    .filter(([_, data]) => data.price !== 'N/A' && data.link)
    .map(([platform, data]) => ({
      platform,
      ...data,
      priority: platforms[platform].priority
    }));

  if (availablePrices.length === 0) {
    const highestPriority = Object.entries(platforms)
      .sort(([, a], [, b]) => a.priority - b.priority)[0][0];
    return prices[highestPriority] || { price: 'N/A', link: null };
  }

  return availablePrices.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Extracts the Weidian product ID from a given URL.
 * @param {string} url - The Weidian product URL to extract the ID from.
 * @returns {string|null} The extracted product ID if found, null if extraction fails.
 * @example
 * // Returns "7234120843"
 * extractWeidianId("https://shop123456.v.weidian.com/item.html?itemID=7234120843")
 */
function extractWeidianId(url) {
  try {
    const urlObj = new URL(url);
    const itemId = urlObj.searchParams.get('itemID');
    return itemId || null;
  } catch (error) {
    console.error('Error extracting Weidian ID:', error);
    return null;
  }
}

/**
 * Extracts the Taobao product ID from a given URL.
 * @param {string} url - The Taobao product URL to extract the ID from.
 * @returns {string|null} The extracted product ID if found, null if extraction fails.
 * @example
 * // Returns "12345"
 * extractTaobaoId("https://item.taobao.com/item.htm?id=12345")
 * // Returns "12345" 
 * extractTaobaoId("https://item.taobao.com/12345")
 */
function extractTaobaoId(url) {
  try {
    if (url.includes('?')) {
      const urlObj = new URL(url);
      const idParam = urlObj.searchParams.get('id');
      if (idParam) return idParam;
    }
    
    const pathParts = url.split('/');
    return pathParts[pathParts.length - 1];
  } catch (error) {
    console.error('Error extracting Taobao ID:', error);
    return null;
  }
}

/**
 * Fetches product details from a given product link, including price and platform links.
 * @async
 * @param {string} productLink - The URL of the product to fetch details from
 * @returns {Promise<Object>} Product details including prices from both platforms
 */
async function fetchProductDetails(productLink) {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout')), 10000)
  );

  try {
    const response = await Promise.race([
      fetch(productLink),
      timeout
    ]);
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const subtitleDiv = doc.querySelector('.showalbumheader__gallerysubtitle.htmlwrap__main');
    const content = subtitleDiv?.textContent || '';
    
    const taobaoMatch = content.match(/item\.taobao\.com[^\s"]*/);
    const weidianMatch = content.match(/shop\d+\.v\.weidian\.com\/item\.html\?[^\s"]*/);
    
    const prices = {
      taobao: { price: 'N/A', link: null },
      weidian: { price: 'N/A', link: null }
    };

    const fetchPriceForPlatform = async (platform, link, extractId) => {
      const productId = extractId(`https://${link}`);
      if (productId) {
        prices[platform].link = link;
        const jadeshipUrl = `${PLATFORM_CONFIG.platforms[platform].baseUrl}${productId}`;
        try {
          const priceResponse = await chrome.runtime.sendMessage({
            type: 'fetchPrice',
            url: jadeshipUrl
          });
          if (priceResponse?.success) {
            const priceDoc = parser.parseFromString(priceResponse.data, 'text/html');
            const priceDiv = priceDoc.querySelector('.rounded-sm.bg-muted.p-1.text-right.text-3xl');
            prices[platform].price = priceDiv?.querySelector('span')?.textContent || 'N/A';
          }
        } catch (error) {
          console.error(`${platform} price fetch error:`, error);
        }
      }
    };

    // Fetch prices concurrently
    await Promise.all([
      taobaoMatch ? fetchPriceForPlatform('taobao', taobaoMatch[0], extractTaobaoId) : Promise.resolve(),
      weidianMatch ? fetchPriceForPlatform('weidian', weidianMatch[0], extractWeidianId) : Promise.resolve()
    ]);

    return selectPlatformPrice(prices);
  } catch (error) {
    console.error('Product fetch error:', error);
    return { price: 'N/A', link: null };
  }
}

/**
 * Processes a product element by adding an interactive price badge that appears on hover.
 * The price badge fetches and displays product details asynchronously.
 * 
 * @param {HTMLElement} product - The DOM element representing the product container
 * @returns {Promise<void>} A promise that resolves when the product processing is complete
 * @throws {Error} When there are issues processing the product or fetching product details
 * 
 * @example
 * const productElement = document.querySelector('.product');
 * await processProduct(productElement);
 */
async function processProduct(product) {
  try {
    const titleElement = product.querySelector('a');
    if (!titleElement || titleElement.hasAttribute('data-processed')) {
      return;
    }

    titleElement.setAttribute('data-processed', 'true');
    
    const { container, badge, retryButton } = createPriceBadge();
    titleElement.insertBefore(container, titleElement.firstChild);
    titleElement.insertBefore(document.createTextNode(' '), container.nextSibling);

    let isHovered = false;

    const fetchAndUpdatePrice = async (useCache = true) => {
      try {
        let productDetails = useCache ? await productCache.get(titleElement.href) : null;

        if (!productDetails) {
          badge.textContent = 'Loading...';
          retryButton.style.display = 'none';
          productDetails = await fetchProductDetails(titleElement.href);
          await productCache.set(titleElement.href, productDetails);
        }

        if (isHovered) {
          badge.textContent = productDetails.price;
          retryButton.style.display = productDetails.price === 'N/A' ? 'inline-block' : 'none';
        }
      } catch (error) {
        console.error('Error fetching product details:', error);
        badge.textContent = 'Error';
        retryButton.style.display = 'inline-block';
      }
    };

    titleElement.addEventListener('mouseenter', async () => {
      isHovered = true;
      badge.style.opacity = '1';
      retryButton.style.opacity = '1';
      await fetchAndUpdatePrice(true);
    });

    titleElement.addEventListener('mouseleave', () => {
      isHovered = false;
      badge.style.opacity = '0';
      retryButton.style.opacity = '0';
    });

    retryButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await fetchAndUpdatePrice(false);
    });

  } catch (error) {
    console.error('Error processing product:', error);
  }
}

/**
 * Processes all unmodified products found on the page by selecting elements with class 'showindex__children'
 * that don't have the 'data-modified' attribute.
 * 
 * @async
 * @function processProducts
 * @returns {Promise<void>} A promise that resolves when all products have been processed
 * @throws {Error} Logs error to console if processing of individual product fails
 * 
 * @description
 * - Finds all unprocessed products using querySelector
 * - Iterates through products asynchronously
 * - Marks products as processed using data-modified attribute
 * - Continues processing remaining products even if individual product fails
 */
async function processProducts() {
  const products = document.querySelectorAll('.showindex__children:not([data-modified])');
  const productsArray = Array.from(products);
  
  if (DEBUG) {
    console.log(`Found ${productsArray.length} products to process`);
  }

  for (const product of productsArray) {
    try {
      await processProduct(product);
      product.setAttribute('data-modified', 'true');
    } catch (error) {
      console.error('Failed to process product:', error);
      continue;
    }
  }
}

/**
 * Initializes the extension by setting up the UI, processing products, and adding animation styles.
 * This function performs the following tasks:
 * 1. Waits for the product cache to initialize
 * 2. Sets up the user interface
 * 3. Schedules product processing with a delay
 * 4. Adds CSS animation styles to the document
 * 
 * @async
 * @function initializeExtension
 * @throws {Error} When initialization fails
 * @returns {Promise<void>}
 */
async function initializeExtension() {
  try {
    await productCache.waitForInitialization();
    initializeUI();
    setTimeout(processProducts, 1000);

    const style = document.createElement("style");
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  } catch (error) {
    console.error('Extension initialization error:', error);
  }
}


// --- DON'T TOUCH HERE ---
let processingQueue = false;
const observer = new MutationObserver(async (mutations) => {
  if (processingQueue) return;
  
  const hasNewProducts = mutations.some(mutation => 
    Array.from(mutation.addedNodes).some(node => 
      node.nodeType === 1 && 
      (node.classList?.contains('showindex__children') || 
       node.querySelector?.('.showindex__children'))
    )
  );

  if (hasNewProducts) {
    processingQueue = true;
    try {
      await processProducts();
    } finally {
      processingQueue = false;
    }
  }
});

initializeExtension();
observer.observe(document.body, {
  childList: true,
  subtree: true
});
// -- END OF DON'T TOUCH --
