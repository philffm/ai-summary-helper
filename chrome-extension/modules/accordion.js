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
                contentEl.style.maxHeight = null;
            });
            // Remove 'active' class from all buttons
            accordionButtons.forEach(btn => btn.classList.remove('active'));
            // If the clicked button was not active, activate it
            if (!isActive) {
                button.classList.add('active');
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    });
}
