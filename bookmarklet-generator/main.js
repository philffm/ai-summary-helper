document.addEventListener('DOMContentLoaded', () => {
    const savedApiKey = localStorage.getItem('openaiApiKey');
    if (savedApiKey) {
      document.getElementById('apiKey').value = savedApiKey;
    }
  });
  
  document.getElementById('apiKey').addEventListener('input', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (apiKey) {
      localStorage.setItem('openaiApiKey', apiKey);
    }
  });
  
  function generateBookmarklet() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const prompt = document.getElementById('prompt').value.trim();
  
    if (!apiKey || !prompt) {
      alert('Please provide both the API key and the prompt.');
      return;
    }
  
    const bookmarkletCode = `
      javascript:(function() {
        const apiKey = '${apiKey}';
        const prompt = \`${prompt}\`;
        const content = document.body.innerText;
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: 'Summarize in valid HTML format with sections:' + prompt },
              { role: 'user', content: content }
            ]
          })
        })
        .then(response => response.json())
        .then(result => {
          const summary = result.choices[0].message.content;
          const summaryContainer = document.createElement('blockquote');
          summaryContainer.innerHTML = '<div><h2>AI Summary 🧙</h2>' + summary.replace(/\\n\\n/g, '<br>') + '</div>';
          
          // Find the main content block and the last <h1> element
          const mainContentBlock = document.querySelector('main') || document.body;
          const lastH1 = mainContentBlock.querySelectorAll('h1');
          if (lastH1.length > 0) {
            lastH1[lastH1.length - 1].insertAdjacentElement('afterend', summaryContainer);
          } else {
            mainContentBlock.prepend(summaryContainer);
          }
        })
        .catch(error => {
          console.error('Error:', error);
          alert('Error fetching summary. Check the console for details.');
        });
      })();
    `;
  
    const encodedBookmarklet = 'javascript:' + encodeURIComponent(bookmarkletCode);
    const outputDiv = document.getElementById('output');
    outputDiv.innerHTML = `<p>Drag the link below to your bookmarks bar:</p><a href="${encodedBookmarklet}">AI Summary Bookmarklet</a>`;
  }
  