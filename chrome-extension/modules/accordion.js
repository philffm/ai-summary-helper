// Accordion
// Handles accordion UI behavior

// Accordion UI behavior only
export function initAccordion() {
    const accordionContainer = document.querySelector('.accordion');
    if (!accordionContainer) return;
    const accordionButtons = accordionContainer.querySelectorAll('.accordion-button');
    accordionButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const content = button.nextElementSibling;
            const isActive = button.classList.contains('active');
            
            // Close all accordion contents
            accordionContainer.querySelectorAll('.accordion-content').forEach(contentEl => {
                // If it was previously set to 'none' for dynamic growth, 
                // we must set it back to a pixel value so the closing transition works.
                if (contentEl.style.maxHeight === 'none') {
                    contentEl.style.maxHeight = contentEl.scrollHeight + 'px';
                    contentEl.offsetHeight; // Trigger reflow
                }
                contentEl.style.maxHeight = null;
            });

            // Remove 'active' class from all buttons
            accordionButtons.forEach(btn => btn.classList.remove('active'));

            // If the clicked button was not active, activate it
            if (!isActive) {
                button.classList.add('active');
                content.style.maxHeight = content.scrollHeight + 'px';

                // Once open transition finishes, switch to 'none' to allow 
                // internal content to grow (e.g. when Ollama endpoint fields appear)
                const handleTransitionEnd = () => {
                    if (button.classList.contains('active')) {
                        content.style.maxHeight = 'none';
                    }
                    content.removeEventListener('transitionend', handleTransitionEnd);
                };
                content.addEventListener('transitionend', handleTransitionEnd);
            }
        });
    });
}
