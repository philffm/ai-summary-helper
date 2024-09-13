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

  function getDonationMessage() {
  const donationMessages = [
    'Like the extension? Help me brew new ideas with a soothing cup of tea! 🍵',
    'Love the extension? Help me upgrade my workspace with a new plant! 🌿',
    'Want to support? Buy me a book to inspire the next feature! 📚',
    'Supporting my work? Help me fund a tiny house to code in peace! 🏡',
    'Love this project? Get me closer to my goal of relocating into a sailboat! 🚤',
    'Feeling generous? A pizza would definitely boost my brainstorming sessions! 🍕',
    'Enjoying the tool? Help me turn my remote work into a van life adventure! 🚐',
    'Happy with the tool? Your support can help me build my tiny home! 🏠',
    'Appreciate the extension? Buy me a kayak to paddle through my creative process! 🛶',
    'Like innovation? Support my mission to design from the deck of a boat! ⛴️',
    'Enjoying the tool? Get me a smoothie to recharge my problem-solving skills! 🥤'
  ];
  
  
    const randomMessage = donationMessages[Math.floor(Math.random() * donationMessages.length)];
    return `<a href="https://link.philwornath.com/?source=aish#donate" target="_blank">${randomMessage}</a>`;
  }
  
  
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
            outline: 4px dashed #007bff;
            background-color: rgba(0, 123, 255, 0.1);
            animation: fadeInOut 2s;
            outline-offset: 4px;
          }
          #donation-message {
            position: fixed;
            bottom: 0;
            left: 0;
            width: 100%;
            background-color: #28a745;
            color: white;
            text-align: center;
            padding: 10px 0;
            z-index: 10000;
            font-size: 18px;
            font-weight: bold;
          }
          #donation-message a {
            color: white;
            text-decoration: underline;
            margin-left: 5px;
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
  
            // Show donation message
            const donationMessage = document.createElement('div');
            donationMessage.id = 'donation-message';
            donationMessage.innerHTML = \`${getDonationMessage()} <a href="https://link.philwornath.com/?source=aish#donate" target="_blank">💸 Donate</a>\`;
            document.body.appendChild(donationMessage);
    
            setTimeout(() => {
              donationMessage.remove();
            }, 20000);
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
  