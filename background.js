
/**
 * Listens for messages from content scripts requesting price data fetching.
 * Sets up a message listener that handles 'fetchPrice' type requests by making a fetch call
 * to the provided URL with specific headers and security settings.
 * 
 * @param {Object} request - The message request object
 * @param {string} request.type - The type of request ('fetchPrice')
 * @param {string} request.url - The URL to fetch price data from
 * @param {Object} sender - Information about the sender of the message
 * @param {Function} sendResponse - Callback function to send response back to the content script
 * @returns {boolean} - Returns true to indicate that the response will be sent asynchronously
 * 
 * @throws {Error} Throws an error if the HTTP response is not OK
 * 
 * @callback sendResponse
 * @param {Object} response - The response object
 * @param {boolean} response.success - Indicates if the fetch was successful
 * @param {string} [response.data] - The fetched HTML content if successful
 * @param {string} [response.error] - Error message if the fetch failed
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'fetchPrice') {
    fetch(request.url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text();
    })
    .then(html => {
      sendResponse({ success: true, data: html });
    })
    .catch(error => {
      console.error('Background fetch error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});