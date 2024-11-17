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
  preferredCurrency: 'usd',
  supportedCurrencies: ['cny', 'usd', 'eur', 'gbp', 'try'],
  platforms: {
    taobao: {
      baseUrl: 'https://www.jadeship.com/item/taobao/',
      priority: 1
    },
    weidian: {
      baseUrl: 'https://www.jadeship.com/item/weidian/',
      priority: 2
    }
  },

  preferredAgent: "superbuy",
  agents: {
    superbuy: {
      baseUrl: 'https://www.superbuy.com/en/page/buy/?nTag=Home-search&from=search-input&url='
    },

    allchinabuy: {
      baseUrl: 'https://www.allchinabuy.com/en/page/buy/?nTag=Home-search&from=search-input&url='
    },
    cssbuy: {
      baseUrl: 'https://www.cssbuy.com/item-',
      formatUrl: (platform, productId) => {
        if (platform === 'weidian') {
          return `https://www.cssbuy.com/item-micro-${productId}.html`;
        }
        return `https://www.cssbuy.com/item-${productId}.html`;
      }
    },
    cnfans: {
      baseUrl: 'https://cnfans.com/product/',
      formatUrl: (platform, productId) => {
        return `https://cnfans.com/product/?shop_type=${platform}&id=${productId}`;
      }
    },
    mulebuy: {
      baseUrl: 'https://mulebuy.com/product/',
      formatUrl: (platform, productId) => {
        return `https://cnfans.com/product/?shop_type=${platform}&id=${productId}`;
      }
    },
    hoobuy: {
      baseUrl: 'https://hoobuy.com/product/',
      formatUrl: (platform, productId) => {
        const platformId = platform === 'taobao' ? '1' : '2';
        return `https://hoobuy.com/product/${platformId}/${productId}`;
      }
    }
  }
};

const CACHE_CONFIG = {
  version: '1.0.0',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  maxItems: 1000,
};

const BOOKMARK_CONFIG = {
  version: '1.0.0',
  maxItems: 100
};

const CURRENCY_CACHE = {
  version: '1.0.0',
  rates: null,
  lastUpdate: null,
  updateInterval: 1 * 60 * 60 * 1000,
};

async function fetchExchangeRates() {
  if (CURRENCY_CACHE.rates && 
      CURRENCY_CACHE.lastUpdate && 
      Date.now() - CURRENCY_CACHE.lastUpdate < CURRENCY_CACHE.updateInterval) {
    return CURRENCY_CACHE.rates;
  }

  const urls = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
    'https://latest.currency-api.pages.dev/v1/currencies/cny.json'
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      
      const data = await response.json();
      CURRENCY_CACHE.rates = data.cny;
      CURRENCY_CACHE.lastUpdate = Date.now();
      return CURRENCY_CACHE.rates;
    } catch (error) {
      console.error(`Error fetching rates from ${url}:`, error);
    }
  }
  
  throw new Error('Failed to fetch exchange rates from all sources');
}

function convertCurrency(amount, fromCurrency, toCurrency) {
  if (!CURRENCY_CACHE.rates) return amount;
  
  const rate = CURRENCY_CACHE.rates[toCurrency.toLowerCase()];
  if (!rate) return amount;

  const converted = amount * rate;
  return Number(converted.toFixed(2));
}

function formatCurrency(amount, currency) {
  const symbols = {
    usd: '$',
    eur: '€',
    gbp: '£',
    try: '₺',
    cny: '¥'
  };

  const symbol = symbols[currency.toLowerCase()] || '';
  return `${symbol}${amount}`;
}

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

class BookmarkManager {
  constructor() {
    this.bookmarks = new Map();
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      const result = await chrome.storage.local.get('bookmarks');
      if (result.bookmarks) {
        this.bookmarks = new Map(Object.entries(result.bookmarks));
      }
      
      this.initialized = true;
      if (DEBUG) {
        console.log('Bookmarks initialized with', this.bookmarks.size, 'items');
      }
    } catch (error) {
      console.error('Bookmarks initialization error:', error);
      this.initialized = true;
    }
  }

  async waitForInitialization() {
    await this.initPromise;
  }

  async add(title, url) {
    await this.waitForInitialization();
    
    const bookmark = {
      title,
      url,
      timestamp: Date.now()
    };

    this.bookmarks.set(url, bookmark);
    await this.persistToStorage();
  }

  async remove(url) {
    await this.waitForInitialization();
    this.bookmarks.delete(url);
    await this.persistToStorage();
  }

  async getAll() {
    await this.waitForInitialization();
    return Array.from(this.bookmarks.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async persistToStorage() {
    try {
      const bookmarkObject = Object.fromEntries(this.bookmarks);
      await chrome.storage.local.set({ bookmarks: bookmarkObject });
    } catch (error) {
      console.error('Bookmark persistence error:', error);
    }
  }
}

const bookmarkManager = new BookmarkManager();

// --- START DON'T TOUCH ---
const productCache = new PersistentCache();


function initializeUI() {
  document.body.style.backgroundColor = "#f0f8ff";
  
  const buttonContainer = document.createElement("div");
  buttonContainer.style.position = "fixed";
  buttonContainer.style.top = "10px";
  buttonContainer.style.right = "10px";
  buttonContainer.style.display = "flex";
  buttonContainer.style.gap = "8px";
  buttonContainer.style.zIndex = "10000";

  if (window.location.href.includes('/albums/')) {
    const sizeChartButton = document.createElement("div");
    sizeChartButton.textContent = "📏";  // Or use a chart icon
    sizeChartButton.style.backgroundColor = "#ffffff";
    sizeChartButton.style.padding = "8px";
    sizeChartButton.style.borderRadius = "50%";
    sizeChartButton.style.cursor = "pointer";
    sizeChartButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
    sizeChartButton.addEventListener('click', showSizeChart);
    buttonContainer.appendChild(sizeChartButton);
  }

  const bookmarkButton = document.createElement("div");
  bookmarkButton.textContent = "🔖";
  bookmarkButton.style.backgroundColor = "#ffffff";
  bookmarkButton.style.padding = "8px";
  bookmarkButton.style.borderRadius = "50%";
  bookmarkButton.style.cursor = "pointer";
  bookmarkButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
  
  const settingsButton = document.createElement("div");
  settingsButton.textContent = "⚙️";
  settingsButton.style.backgroundColor = "#ffffff";
  settingsButton.style.padding = "8px";
  settingsButton.style.borderRadius = "50%";
  settingsButton.style.cursor = "pointer";
  settingsButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
  
  buttonContainer.appendChild(bookmarkButton);
  buttonContainer.appendChild(settingsButton);
  document.body.appendChild(buttonContainer);
  
  settingsButton.addEventListener('click', showSettingsPopup);
  bookmarkButton.addEventListener('click', showBookmarksPopup);

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

  const quickBuyButton = document.createElement('span');
  quickBuyButton.style.backgroundColor = '#1976d2';
  quickBuyButton.style.color = '#ffffff';
  quickBuyButton.style.padding = '1px 4px';
  quickBuyButton.style.borderRadius = '2px';
  quickBuyButton.style.fontSize = '0.9em';
  quickBuyButton.style.fontWeight = '400';
  quickBuyButton.style.opacity = '0';
  quickBuyButton.style.transition = 'opacity 0.3s ease';
  quickBuyButton.style.cursor = 'pointer';
  quickBuyButton.textContent = 'Quick Buy';
  quickBuyButton.style.display = 'none';

  container.appendChild(badge);
  container.appendChild(retryButton);
  container.appendChild(quickBuyButton);
  return { container, badge, retryButton, quickBuyButton };
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
    const weidianMatch = content.match(/(?:shop\d+\.v\.weidian\.com|weidian\.com)\/item\.html\?[^\s"]*/);
    
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
 * Calculates the final price including agent service fees.
 * Different agents have different markup rates:
 * - Superbuy: 2.38% fixed markup
 * - CSSBuy: 2% service fee
 * - AllChinaBuy: 4% service fee
 * - Others: 3% default markup
 * 
 * Note: These are basic estimates and actual costs may vary based on:
 * - Order value tiers
 * - Additional service fees
 * - Shipping costs
 * - Payment processing fees
 * 
 * @param {number} price - The original price in CNY
 * @param {string} agent - The agent name ('superbuy', 'cssbuy', 'allchinabuy')
 * @returns {number} The price with agent fee applied
 * 
 * @example
 * // Returns 102.38
 * calculateAgentFee(100, 'superbuy')
 * 
 * // Returns 102
 * calculateAgentFee(100, 'cssbuy')
 * 
 * // Returns 104
 * calculateAgentFee(100, 'allchinabuy')
 */
function calculateAgentFee(price, agent) {
  switch (agent.toLowerCase()) {
    case 'superbuy':
      return price * 1.0238;
      
    case 'cssbuy':
      return price * 1.02;
      
    case 'allchinabuy':
      return price * 1.04;
      
    default:
      return price * 1.03;
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
    
    const { container, badge, retryButton, quickBuyButton } = createPriceBadge();
    titleElement.insertBefore(container, titleElement.firstChild);
    titleElement.insertBefore(document.createTextNode(' '), container.nextSibling);

    let isHovered = false;
    let currentProductDetails = null;

    const fetchAndUpdatePrice = async (useCache = true) => {
      try {
        let productDetails = useCache ? await productCache.get(titleElement.href) : null;

        if (!productDetails) {
          badge.textContent = 'Loading...';
          retryButton.style.display = 'none';
          quickBuyButton.style.display = 'none';
          productDetails = await fetchProductDetails(titleElement.href);
          await productCache.set(titleElement.href, productDetails);
        }

        currentProductDetails = productDetails;

        if (isHovered) {
          if (productDetails.price !== 'N/A') {
            const priceNumber = parseFloat(productDetails.price.replace(/[^0-9.]/g, ''));
            if (!isNaN(priceNumber)) {
              const priceWithFee = calculateAgentFee(priceNumber, PLATFORM_CONFIG.preferredAgent);
              const rates = await fetchExchangeRates();
              const convertedPrice = convertCurrency(priceWithFee, 'cny', PLATFORM_CONFIG.preferredCurrency);

              badge.textContent = formatCurrency(convertedPrice, PLATFORM_CONFIG.preferredCurrency);
              
              if (DEBUG) {
                const originalConverted = convertCurrency(priceNumber, 'cny', PLATFORM_CONFIG.preferredCurrency);
                badge.textContent += ` (${formatCurrency(originalConverted, PLATFORM_CONFIG.preferredCurrency)})`;
              }
            } else {
              badge.textContent = productDetails.price;
            }
          } else {
            badge.textContent = productDetails.price;
          }
          
          retryButton.style.display = productDetails.price === 'N/A' ? 'inline-block' : 'none';
          quickBuyButton.style.display = productDetails.link ? 'inline-block' : 'none';
        }
      } catch (error) {
        console.error('Error fetching product details:', error);
        badge.textContent = 'Error';
        retryButton.style.display = 'inline-block';
        quickBuyButton.style.display = 'none';
      }
    };

    titleElement.addEventListener('mouseenter', async () => {
      isHovered = true;
      badge.style.opacity = '1';
      retryButton.style.opacity = '1';
      quickBuyButton.style.opacity = '1';
      await fetchAndUpdatePrice(true);
    });

    titleElement.addEventListener('mouseleave', () => {
      isHovered = false;
      badge.style.opacity = '0';
      retryButton.style.opacity = '0';
      quickBuyButton.style.opacity = '0';
    });

    retryButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await fetchAndUpdatePrice(false);
    });

    quickBuyButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (currentProductDetails?.link) {
        const agent = PLATFORM_CONFIG.agents[PLATFORM_CONFIG.preferredAgent];
        
        let buyUrl;
        if (agent.formatUrl) {
          const productId = currentProductDetails.platform === 'weidian' 
            ? extractWeidianId(`https://${currentProductDetails.link}`)
            : extractTaobaoId(`https://${currentProductDetails.link}`);
          
          buyUrl = agent.formatUrl(currentProductDetails.platform, productId);
        } else {
          const encodedUrl = encodeURIComponent(`https://${currentProductDetails.link}`);
          buyUrl = `${agent.baseUrl}${encodedUrl}`;
        }
        
        window.open(buyUrl, '_blank');
      }
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
    await loadPreferences();
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

async function loadPreferences() {
  try {
    const result = await chrome.storage.local.get('preferences');
    if (result.preferences) {
      PLATFORM_CONFIG.preferredPlatform = result.preferences.platform || PLATFORM_CONFIG.preferredPlatform;
      PLATFORM_CONFIG.preferredAgent = result.preferences.agent || PLATFORM_CONFIG.preferredAgent;
      PLATFORM_CONFIG.preferredCurrency = result.preferences.currency || PLATFORM_CONFIG.preferredCurrency;
    }

    await fetchExchangeRates();
  } catch (error) {
    console.error('Error loading preferences:', error);
  }
}

async function savePreferences(platform, agent, currency) {
  try {
    await chrome.storage.local.set({
      preferences: {
        platform,
        agent,
        currency
      }
    });
    PLATFORM_CONFIG.preferredPlatform = platform;
    PLATFORM_CONFIG.preferredAgent = agent;
    PLATFORM_CONFIG.preferredCurrency = currency;
  } catch (error) {
    console.error('Error saving preferences:', error);
  }
}

function createSelect(options, value) {
  const select = document.createElement('select');
  select.style.padding = '5px';
  select.style.marginLeft = '10px';
  select.style.borderRadius = '4px';
  select.style.border = '1px solid #ccc';
  
  options.forEach(option => {
    const optElement = document.createElement('option');
    optElement.value = option;
    optElement.textContent = option;
    optElement.selected = option === value;
    select.appendChild(optElement);
  });
  
  return select;
}

function showSettingsPopup() {
  const style = document.createElement('style');
  style.textContent = `
    .settings-overlay {
      position: fixed;
      inset: 0;
      background-color: rgba(10, 10, 10, 0.3);
      backdrop-filter: blur(8px);
      z-index: 10001;
      opacity: 0;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .settings-popup {
      position: relative;
      background: #ffffff;
      padding: 32px;
      border-radius: 24px;
      width: 420px;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.18);
      opacity: 0;
      transform: translateY(16px);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .settings-title {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin: 0 0 32px 0;
    }
    
    .settings-tabs {
      display: flex;
      gap: 24px;
      margin-bottom: 32px;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }
    
    .settings-tab {
      padding: 8px 4px;
      background: transparent;
      border: none;
      color: #6b7280;
      cursor: pointer;
      font-size: 15px;
      font-weight: 500;
      transition: all 0.2s ease;
      position: relative;
    }
    
    .settings-tab::after {
      content: '';
      position: absolute;
      bottom: -5px;
      left: 0;
      width: 100%;
      height: 2px;
      background: #2563eb;
      transform: scaleX(0);
      transition: transform 0.2s ease;
    }
    
    .settings-tab:hover {
      color: #2563eb;
    }
    
    .settings-tab.active {
      color: #2563eb;
    }
    
    .settings-tab.active::after {
      transform: scaleX(1);
    }
    
    .settings-panel {
      display: none;
    }
    
    .settings-panel.active {
      display: block;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .settings-group {
      margin-bottom: 24px;
    }
    
    .settings-label {
      display: block;
      font-size: 14px;
      color: #4b5563;
      margin-bottom: 8px;
      font-weight: 500;
    }
    
    .settings-select {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      font-size: 15px;
      color: #111827;
      background-color: #f9fafb;
      transition: all 0.2s ease;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%236b7280' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 16px center;
    }
    
    .settings-select:hover {
      border-color: #d1d5db;
      background-color: #f3f4f6;
    }
    
    .settings-select:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

     .settings-credits {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .settings-credits img {
    width: 60px;
    height: auto;
    opacity: 0.9;
  }

  .settings-credits-text {
    color: #6b7280;
    font-size: 13px;
    line-height: 1.5;
    text-align: left;
  }

  .settings-credits a {
    color: #2563eb;
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .settings-credits a:hover {
    color: #1d4ed8;
  }
  
    
    .cache-stats {
      background: #f9fafb;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
    }
    
    .cache-stat-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 14px;
      color: #4b5563;
    }
    
    .cache-stat-value {
      font-weight: 500;
      color: #111827;
    }
    
    .cache-actions {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    
    .cache-button {
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #ffffff;
      color: #111827;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .cache-button:hover {
      border-color: #2563eb;
      color: #2563eb;
      background: #f8faff;
    }
    
    .cache-button.danger {
      border-color: #ef4444;
      color: #ef4444;
    }
    
    .cache-button.danger:hover {
      background: #fef2f2;
    }
    
    .settings-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    
    .settings-button {
      padding: 12px 24px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .settings-button-save {
      background-color: #2563eb;
      color: white;
    }
    
    .settings-button-save:hover {
      background-color: #1d4ed8;
    }
    
    .settings-button-cancel {
      background-color: #f3f4f6;
      color: #4b5563;
    }
    
    .settings-button-cancel:hover {
      background-color: #e5e7eb;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';

  const popup = document.createElement('div');
  popup.className = 'settings-popup';

  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = 'Settings';

  const tabs = document.createElement('div');
  tabs.className = 'settings-tabs';
  
  const createTab = (label, isActive = false) => {
    const tab = document.createElement('button');
    tab.className = `settings-tab ${isActive ? 'active' : ''}`;
    tab.textContent = label;
    return tab;
  };

  const generalTab = createTab('General', true);
  const cacheTab = createTab('Cache');
  
  tabs.appendChild(generalTab);
  tabs.appendChild(cacheTab);

  const generalPanel = document.createElement('div');
  generalPanel.className = 'settings-panel active';

  const platformGroup = document.createElement('div');
  platformGroup.className = 'settings-group';
  
  const platformLabel = document.createElement('label');
  platformLabel.className = 'settings-label';
  platformLabel.textContent = 'Preferred Platform';
  
  const platformSelect = document.createElement('select');
  platformSelect.className = 'settings-select';
  Object.keys(PLATFORM_CONFIG.platforms).forEach(platform => {
    const option = document.createElement('option');
    option.value = platform;
    option.textContent = platform.charAt(0).toUpperCase() + platform.slice(1);
    option.selected = platform === PLATFORM_CONFIG.preferredPlatform;
    platformSelect.appendChild(option);
  });

  const agentGroup = document.createElement('div');
  agentGroup.className = 'settings-group';
  
  const agentLabel = document.createElement('label');
  agentLabel.className = 'settings-label';
  agentLabel.textContent = 'Preferred Agent';
  
  const agentSelect = document.createElement('select');
  agentSelect.className = 'settings-select';
  Object.keys(PLATFORM_CONFIG.agents).forEach(agent => {
    const option = document.createElement('option');
    option.value = agent;
    option.textContent = agent.charAt(0).toUpperCase() + agent.slice(1);
    option.selected = agent === PLATFORM_CONFIG.preferredAgent;
    agentSelect.appendChild(option);
  });

  const currencyGroup = document.createElement('div');
  currencyGroup.className = 'settings-group';
  
  const currencyLabel = document.createElement('label');
  currencyLabel.className = 'settings-label';
  currencyLabel.textContent = 'Preferred Currency';
  
  const currencySelect = document.createElement('select');
  currencySelect.className = 'settings-select';
  
  const currencies = [
    { value: 'usd', label: 'USD ($)' },
    { value: 'eur', label: 'EUR (€)' },
    { value: 'gbp', label: 'GBP (£)' },
    { value: 'try', label: 'TRY (₺)' }
  ];

  currencies.forEach(currency => {
    const option = document.createElement('option');
    option.value = currency.value;
    option.textContent = currency.label;
    option.selected = currency.value === PLATFORM_CONFIG.preferredCurrency;
    currencySelect.appendChild(option);
  });

  const creditsSection = document.createElement('div');
  creditsSection.className = 'settings-credits';

  const logo = document.createElement('img');
  logo.src = chrome.runtime.getURL('static/jadeship.png');
  logo.alt = 'Jadeship Logo';

  const creditsText = document.createElement('div');
  creditsText.className = 'settings-credits-text';
  creditsText.innerHTML = `
    Made by <a href="https://github.com/1etu" target="_blank">etulastrada</a><br>
    Powered by <a href="https://jadeship.com" target="_blank">Jadeship</a>
  `;

  creditsSection.appendChild(logo);
  creditsSection.appendChild(creditsText);


  platformGroup.appendChild(platformLabel);
  platformGroup.appendChild(platformSelect);
  agentGroup.appendChild(agentLabel);
  agentGroup.appendChild(agentSelect);
  currencyGroup.appendChild(currencyLabel);
  currencyGroup.appendChild(currencySelect);
  generalPanel.appendChild(platformGroup);
  generalPanel.appendChild(agentGroup);
  generalPanel.appendChild(currencyGroup);

  const cachePanel = document.createElement('div');
  cachePanel.className = 'settings-panel';

  const createCacheStats = async () => {
    const stats = document.createElement('div');
    stats.className = 'cache-stats';
    
    const items = await productCache.data.size;
    const version = CACHE_CONFIG.version;
    const lastCleanup = await chrome.storage.local.get('cacheMetadata')
      .then(data => new Date(data.cacheMetadata?.lastCleanup || 0).toLocaleString());

    const statItems = [
      ['Cached Items', items],
      ['Cache Version', version],
      ['Last Cleanup', lastCleanup],
      ['Max Items', CACHE_CONFIG.maxItems],
      ['Max Age', `${CACHE_CONFIG.maxAge / (24 * 60 * 60 * 1000)} days`]
    ];

    statItems.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'cache-stat-item';
      item.innerHTML = `
        <span>${label}</span>
        <span class="cache-stat-value">${value}</span>
      `;
      stats.appendChild(item);
    });

    return stats;
  };

  const cacheActions = document.createElement('div');
  cacheActions.className = 'cache-actions';

  const createCacheButton = (label, onClick, isDanger = false) => {
    const button = document.createElement('button');
    button.className = `cache-button ${isDanger ? 'danger' : ''}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  const exportCache = async () => {
    const data = {
      version: CACHE_CONFIG.version,
      timestamp: Date.now(),
      items: Object.fromEntries(productCache.data)
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `cache-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  };

  const importCache = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      try {
        const file = e.target.files[0];
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (data.version !== CACHE_CONFIG.version) {
          throw new Error('Cache version mismatch');
        }
        
        await productCache.clearCache();
        for (const [key, value] of Object.entries(data.items)) {
          await productCache.set(key, value.data);
        }
        
        const newStats = await createCacheStats();
        const oldStats = cachePanel.querySelector('.cache-stats');
        oldStats.replaceWith(newStats);
      } catch (error) {
        console.error('Import failed:', error);
        alert('Failed to import cache: ' + error.message);
      }
    };
    
    input.click();
  };

  const buttons = [
    createCacheButton('Export Cache', exportCache),
    createCacheButton('Import Cache', importCache),
    createCacheButton('Clear Cache', async () => {
      if (confirm('Are you sure you want to clear the cache?')) {
        await productCache.clearCache();
        const newStats = await createCacheStats();
        const oldStats = cachePanel.querySelector('.cache-stats');
        oldStats.replaceWith(newStats);
      }
    }, true)
  ];

  buttons.forEach(button => cacheActions.appendChild(button));

  createCacheStats().then(stats => {
    cachePanel.appendChild(stats);
    cachePanel.appendChild(cacheActions);
  });

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'settings-buttons';

  const saveButton = document.createElement('button');
  saveButton.className = 'settings-button settings-button-save';
  saveButton.textContent = 'Save Changes';

  const cancelButton = document.createElement('button');
  cancelButton.className = 'settings-button settings-button-cancel';
  cancelButton.textContent = 'Cancel';

  buttonContainer.appendChild(cancelButton);
  buttonContainer.appendChild(saveButton);

  const switchTab = (tab, panel) => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
  };

  generalTab.addEventListener('click', () => switchTab(generalTab, generalPanel));
  cacheTab.addEventListener('click', () => switchTab(cacheTab, cachePanel));

  popup.appendChild(title);
  popup.appendChild(tabs);
  popup.appendChild(generalPanel);
  popup.appendChild(cachePanel);
  popup.appendChild(buttonContainer);
  popup.appendChild(creditsSection);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    popup.style.opacity = '1';
    popup.style.transform = 'translateY(0)';
  });

  const closePopup = () => {
    overlay.style.opacity = '0';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(16px)';
    setTimeout(() => {
      document.body.removeChild(overlay);
      document.head.removeChild(style);
    }, 300);
  };

  saveButton.addEventListener('click', async () => {
    await savePreferences(platformSelect.value, agentSelect.value, currencySelect.value);
    closePopup();
  });

  cancelButton.addEventListener('click', closePopup);
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePopup();
  });
}

function showBookmarksPopup() {
  const style = document.createElement('style');
  style.textContent = `
    .bookmark-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 10001;
    }

    .bookmark-popup {
      background: white;
      padding: 24px;
      border-radius: 16px;
      width: 400px;
      max-width: 90%;
      opacity: 0;
      transform: translateY(16px);
      transition: all 0.3s ease;
    }

    .bookmark-title {
      margin: 0 0 24px;
      font-size: 24px;
      font-weight: 600;
      color: #111827;
    }

    .bookmark-list {
      max-height: 300px;
      overflow-y: auto;
      margin-bottom: 16px;
    }

    .bookmark-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 8px;
    }

    .bookmark-item-title {
      font-weight: 500;
      color: #111827;
      text-decoration: none;
    }

    .bookmark-item-remove {
      color: #ef4444;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .bookmark-item-remove:hover {
      background: #fef2f2;
    }

    .bookmark-add {
      width: 100%;
      padding: 12px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .bookmark-add:hover {
      background: #1d4ed8;
    }

    .bookmark-empty {
      text-align: center;
      color: #6b7280;
      padding: 24px 0;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'bookmark-overlay';

  const popup = document.createElement('div');
  popup.className = 'bookmark-popup';

  const title = document.createElement('h2');
  title.className = 'bookmark-title';
  title.textContent = 'Bookmarks';

  const bookmarkList = document.createElement('div');
  bookmarkList.className = 'bookmark-list';

  const addButton = document.createElement('button');
  addButton.className = 'bookmark-add';
  addButton.textContent = 'Add Current Page';

  const updateBookmarkList = async () => {
    const bookmarks = await bookmarkManager.getAll();
    bookmarkList.innerHTML = '';

    if (bookmarks.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'bookmark-empty';
      emptyState.textContent = 'No bookmarks yet';
      bookmarkList.appendChild(emptyState);
    } else {
      bookmarks.forEach(bookmark => {
        const item = document.createElement('div');
        item.className = 'bookmark-item';

        const link = document.createElement('a');
        link.className = 'bookmark-item-title';
        link.href = bookmark.url;
        link.textContent = bookmark.title;
        link.target = '_blank';

        const removeButton = document.createElement('span');
        removeButton.className = 'bookmark-item-remove';
        removeButton.textContent = '✕';
        removeButton.onclick = async (e) => {
          e.preventDefault();
          await bookmarkManager.remove(bookmark.url);
          updateBookmarkList();
        };

        item.appendChild(link);
        item.appendChild(removeButton);
        bookmarkList.appendChild(item);
      });
    }
  };

  const promptForTitle = () => {
    const title = prompt('Enter a title for this bookmark:');
    if (title) {
      bookmarkManager.add(title, window.location.href);
      updateBookmarkList();
    }
  };

  addButton.onclick = promptForTitle;

  popup.appendChild(title);
  popup.appendChild(bookmarkList);
  popup.appendChild(addButton);
  overlay.appendChild(popup);
  document.body.appendChild(overlay);

  updateBookmarkList();

  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    popup.style.opacity = '1';
    popup.style.transform = 'translateY(0)';
  });

  const closePopup = () => {
    overlay.style.opacity = '0';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(16px)';
    setTimeout(() => {
      document.body.removeChild(overlay);
      document.head.removeChild(style);
    }, 300);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePopup();
  });
}
