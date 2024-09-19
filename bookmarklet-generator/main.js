

document.addEventListener('DOMContentLoaded', () => {
  const savedApiKey = localStorage.getItem('apiKey');
  const savedModel = localStorage.getItem('model');
  
  // If API key exists, prefill the input field
  if (savedApiKey) {
    document.getElementById('apiKey').value = savedApiKey;
  }
  
  // If a model is saved, preselect the model and update the API link
  if (savedModel) {
    document.getElementById('model').value = savedModel;
    updateApiLink(savedModel); // Update the API link based on saved model
  }
});

// Store API key in localStorage
document.getElementById('apiKey').addEventListener('input', () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (apiKey) {
    localStorage.setItem('apiKey', apiKey);
  }
});

// Model change listener to store the selected model and update the API link
document.getElementById('model').addEventListener('change', () => {
const model = document.getElementById('model').value.trim();
if (model) {
  localStorage.setItem('model', model);
  updateApiLink(model); // Update the API link based on the selected model
}
});

// Function to update the "Get your API key" link based on the selected model
function updateApiLink(model) {
const apiUrlElement = document.getElementById('apiUrl');
if (model === 'openai') {
  apiUrlElement.innerHTML = 'Get your<a href="https://platform.openai.com/api-keys" target="_blank"> OpenAI API key</a>';
} else if (model === 'mistral') { 
  apiUrlElement.innerHTML = 'Get your<a href="https://console.mistral.ai/api-keys/" target="_blank"> Mistral API key</a>';
} else if (model === 'claude') {
  apiUrlElement.innerHTML = 'Get your<a href="https://console.anthropic.com/" target="_blank"> Anthropic Claude API key</a>';
} else {
  apiUrlElement.innerHTML = ''; // Clear the link if no valid model is selected
}
}



// Function to get the donation message
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

// Function to generate the bookmarklet
function generateBookmarklet() {
const apiKey = document.getElementById('apiKey').value.trim();
const prompt = document.getElementById('prompt').value.trim();
const selectedModel = document.getElementById('model').value.trim();

if (!apiKey || !prompt || !selectedModel) {
  alert('Please provide the API key, model, and prompt.');
  return;
}

let apiUrl;
let modelIdentifier;

let favIcon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAMFSURBVHgBXVNNaFRXFP7OnfcmphnTSX+SJmnNgBBiWzKBQmkqbTPtQiilitZFlYAgIoJg3IjiIiOIGzejLhQEcaHgQjGBKLqaqAkiik78QaOC4xhjXOiME+P45r57j+e9aIg+uIfH+fnO93HOIXzybb6seziC5Wx5BQgJImIwxpg5F2V3V6ab8vPz6cNPX5bjlYjfD+I+Ei9LIQVWYoz3Rh4zMrVGgFJUmgMIimeMzkIhqRTosxihrg5wo4C1BN9nVN4Ar6fB1gqKxZgfcVNHBcQJAMqe3y8Uu6I1BF16jMnbBSxQNAvPYX+8tUBDezuR2wStuQtVr1/cW2nd6UrCKnrkuIQnuSxWt8ewYdXSsGiyAsRcoN6ZlXn41CgGCxqNHUvZaEvCJqW0Vv22Cih+gw4u4tvGzzF64yH2HjmPllpgvAzcevgUZy/dQndnAh0ogsw0WV/kGFqhrNBhoVeeKqA7mcDN8QLODOfww+JvsDNzEl7+Pk4MXcaPi1tw9sIYfmpvAVenIQCwHi9XfpW7rBGlxoqRZ3zs2fofLl29i23r/8botXsC1oyR6+OwJmwbPmlMpsoJJQbVGUvak4AJgn6od/vGf3Fo6Brq62pQH1uANf/8GnQJ49oDdIURSHeMx3koaquULHHrLEgIcHAIba1N2LR22dzSBOwEAZILE0yHkHOs4QHW6KtMR8IOVuhdvHIbi5q/wv9/LMHu/SfC4sLT51jU2ohiqYzilI+6hnDKOaXf8mAgIxptxLFTWfSuTKHhiy+xetlvyE9M4fefv0dnRxu+E8DelX/hzoNnUKoeQY2uql3q3I6Fw0Yjo5w4T5gkdmeOw3iv4XgvUHpVRr4wic4lCfSu+hMHjgxgJN8kimOin/ed21GbD1e5J12MR3w3y6ba9XLiBl5O5qTDzEdHRsrlrxO/ULy5EypSkzOuTg2nG0pzx9TTV4zDddIyyi2zk+Bgi4Nrog93R8oBRdQ+1PrpoPija5wHlLBQadnNpAAkg7uULKHKg+IfGMksHJ6f/w6/N43lzJpMOAAAAABJRU5ErkJggg==';

if (selectedModel === 'openai') {
  apiUrl = 'https://api.openai.com/v1/chat/completions';
  modelIdentifier = 'gpt-4o-mini';
} else if (selectedModel === 'mistral') {
  apiUrl = 'https://api.mistral.ai/v1/chat/completions';
  modelIdentifier = 'mistral-large-latest';
} else if (selectedModel === 'claude') {
  apiUrl = 'https://api.anthropic.com/v1/complete';  // Example URL, adjust based on actual API
  modelIdentifier = 'claude-v1';
} else {
  alert('Invalid model selected.');
  return;
}

const bookmarkletCode = `
  javascript:(function() {
  
    const apiKey = '${apiKey}';
    const prompt = \`${prompt}\`;
    const content = document.body.innerText;

    const apiUrl = '${apiUrl}';
    const modelIdentifier = '${modelIdentifier}';

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

      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: modelIdentifier,
          messages: [
            { role: 'system', content: 'You summarize content from websites in a tailored and meaningful manner.' },
            { role: 'user', content: 'Summarize in valid HTML format with sections:' + prompt },
            { role: 'user', content: content }
          ]
        })
      })
      .then(response => response.json())
      .then(result => {
        const summary = result.choices[0]?.message?.content || 'Error: No summary returned';
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

outputDiv.innerHTML = `
  <p>Drag the link below to your bookmarks bar 🔖 <br> (on iOS, hold to drag for 2 seconds): </p>
  <a href="${encodedBookmarklet}" icon="${favIcon}" draggable="true" >AI Summary 🪄</a>
`;

}
