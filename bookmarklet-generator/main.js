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
  
        // Inject styles
        const style = document.createElement('style');
        style.innerHTML = \`
          #ai-summary-message {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            background-color: #007bff;
            color: white;
            text-align: center;
            padding: 10px 0;
            z-index: 10000;
            font-size: 18px;
            font-weight: bold;
            animation: pulsate 1s infinite;
          }
          @keyframes pulsate {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
          }
          .hover-effect {
            outline: 2px dashed #007bff;
          }
        \`;
        document.head.appendChild(style);
  
        const messageDiv = document.createElement('div');
        messageDiv.id = 'ai-summary-message';
        messageDiv.textContent = 'Click on the element where you want to insert the summary before.';
        document.body.prepend(messageDiv);
  
        document.body.style.cursor = 'crosshair';
  
        function hoverHandler(event) {
          event.target.classList.toggle('hover-effect');
        }
  
        document.addEventListener('mouseover', hoverHandler);
        document.addEventListener('mouseout', hoverHandler);
  
        document.addEventListener('click', function handler(event) {
          event.preventDefault();
          event.stopPropagation();
          document.body.style.cursor = 'default';
          const targetElement = event.target;
  
          document.removeEventListener('click', handler);
          document.removeEventListener('mouseover', hoverHandler);
          document.removeEventListener('mouseout', hoverHandler);
  
          messageDiv.textContent = 'Retrieving summary...';
  
          fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You summarize content from websites in a tailored and meaningful manner.' },
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
  
            targetElement.insertAdjacentElement('beforebegin', summaryContainer);
            messageDiv.remove();
          })
          .catch(error => {
            console.error('Error:', error);
            alert('Error fetching summary. Check the console for details.');
            messageDiv.remove();
          });
        }, { once: true });
      })();
    `;
  
    const encodedBookmarklet = 'javascript:' + encodeURIComponent(bookmarkletCode);
    const outputDiv = document.getElementById('output');
    outputDiv.innerHTML = `<p>Drag the link below to your bookmarks bar 🔖 <br> (on iOS, hold to drag for 2 seconds): </p> <a href="${encodedBookmarklet}">AI Summary 🪄</a>`;
  }
  