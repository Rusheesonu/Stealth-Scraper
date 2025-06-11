document.getElementById('scrape-btn').addEventListener('click', async () => {
  const url = document.getElementById('url-input').value.trim();
  const rulesText = document.getElementById('rules-input').value.trim();
  const usePlaywright = document.getElementById('playwright-mode').checked;

  // Validation
  if (!url) {
    alert('Please enter a URL');
    return;
  }
  if (!rulesText) {
    alert('Please enter extraction rules');
    return;
  }

  // Parse rules (split by newlines and filter empty lines)
  const rules = rulesText.split('\n')
    .map(rule => rule.trim())
    .filter(rule => rule.length > 0);

  if (rules.length === 0) {
    alert('Please enter valid extraction rules');
    return;
  }
  console.log('Extraction Rule:', rulesText);


  // Update UI
  const resultsBox = document.getElementById('results-box');
  const scrapeBtn = document.getElementById('scrape-btn');
  
  resultsBox.textContent = `Scraping with ${usePlaywright ? 'Playwright' : 'Requests'} mode...`;
  scrapeBtn.disabled = true;
  scrapeBtn.textContent = 'Scraping...';

  try {
    console.log('Sending request:', {
      url,
      rules,
      mode: usePlaywright ? 'playwright' : 'requests'
    });

    const response = await fetch('/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        rules,
        mode: usePlaywright ? 'playwright' : 'requests'
      }),
    });

    console.log('Response status:', response.status);
    
    const data = await response.json();
    console.log('Response data:', data);

    if (response.ok) {
      // Format results nicely
      let output = '';
      let hasError = false;
      
      for (const [key, val] of Object.entries(data)) {
        if (key === 'error') {
          hasError = true;
          output += `❌ ERROR: ${val}\n`;
        } else {
          if (Array.isArray(val)) {
            output += `📋 ${key}:\n`;
            val.forEach((item, index) => {
              output += `  ${index + 1}. ${item}\n`;
            });
          } else {
            const status = val.toString().toLowerCase().includes('error') ? '❌' : '✅';
            output += `${status} ${key}: ${val}\n`;
          }
        }
      }
      
      if (output.trim() === '') {
        output = '⚠️ No data extracted. Check your rules and URL.';
      }
      
      resultsBox.textContent = output;
      
      // Color code the results
      if (hasError) {
        resultsBox.style.color = '#dc3545';
      } else {
        resultsBox.style.color = '#28a745';
      }
      
    } else {
      resultsBox.textContent = `❌ Server Error: ${data.error || 'Unknown error occurred'}`;
      resultsBox.style.color = '#dc3545';
    }
    
  } catch (e) {
    console.error('Fetch error:', e);
    resultsBox.textContent = `❌ Network Error: ${e.message}`;
    resultsBox.style.color = '#dc3545';
  } finally {
    // Reset button
    scrapeBtn.disabled = false;
    scrapeBtn.textContent = 'Scrape';
  }
});

// Add some helper functions for better UX
document.getElementById('url-input').addEventListener('input', function() {
  const url = this.value.trim();
  const isValid = url.startsWith('http://') || url.startsWith('https://');
  
  if (url && !isValid) {
    this.style.borderColor = '#dc3545';
    this.title = 'URL must start with http:// or https://';
  } else {
    this.style.borderColor = '';
    this.title = '';
  }
});

// Add example rules button
function addExampleRules() {
  const rulesInput = document.getElementById('rules-input');
  const examples = [
    'title: //title/text()',
    'heading: //h1/text()',
    'links: //a/@href',
    'paragraphs: //p/text()',
    'meta_description: //meta[@name="description"]/@content'
  ].join('\n');
  
  if (rulesInput.value.trim() === '') {
    rulesInput.value = examples;
  } else {
    rulesInput.value += '\n' + examples;
  }
}

// Add the example button to your HTML or call this function when needed
if (document.getElementById('example-rules-btn')) {
  document.getElementById('example-rules-btn').addEventListener('click', addExampleRules);
}