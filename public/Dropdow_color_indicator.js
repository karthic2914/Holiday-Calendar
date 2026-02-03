// Add color indicators to the Type dropdown to match legend colors

// Color mapping matching the legend
const typeColors = {
    'Public Holiday': '#EF4444', // Red
    'Leave': '#3B82F6',          // Blue
    'Sick': '#F97316',           // Orange
    'WFH': '#14B8A6',            // Teal
    'Work Travel': '#8B5CF6'     // Purple
};

// Function to update dropdown with color indicators
function addColorIndicatorsToDropdown() {
    const typeSelect = document.getElementById('entryType');
    if (!typeSelect) return;
    
    // Add custom styling to show color dots
    const options = typeSelect.querySelectorAll('option');
    
    options.forEach(option => {
        const type = option.value;
        const color = typeColors[type];
        
        if (color) {
            // Add color circle emoji or indicator
            const colorDot = '●'; // Colored circle
            if (!option.textContent.startsWith(colorDot)) {
                option.textContent = `${colorDot} ${type}`;
            }
        }
    });
    
    // Update the select styling when value changes
    typeSelect.addEventListener('change', function() {
        const selectedType = this.value;
        const selectedColor = typeColors[selectedType];
        
        if (selectedColor) {
            // Add visual indicator to the select element itself
            this.style.borderLeft = `4px solid ${selectedColor}`;
        }
    });
    
    // Set initial border color
    const initialType = typeSelect.value;
    const initialColor = typeColors[initialType];
    if (initialColor) {
        typeSelect.style.borderLeft = `4px solid ${initialColor}`;
    }
}

// Alternative: Create custom styled dropdown options
function createColoredDropdownOptions() {
    const typeSelect = document.getElementById('entryType');
    if (!typeSelect) return;
    
    // Clear existing options
    typeSelect.innerHTML = '';
    
    // Add options with color styling
    Object.entries(typeColors).forEach(([type, color]) => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = `● ${type}`; // Colored bullet point
        option.style.color = color;
        option.style.fontWeight = '500';
        typeSelect.appendChild(option);
    });
}

// Call this when the modal opens
document.addEventListener('DOMContentLoaded', () => {
    // Apply color indicators when Add Entry modal is shown
    const addEntryButton = document.querySelector('[data-action="add-entry"]') || 
                          document.getElementById('addEntryBtn');
    
    if (addEntryButton) {
        addEntryButton.addEventListener('click', () => {
            setTimeout(() => {
                addColorIndicatorsToDropdown();
            }, 100);
        });
    }
    
    // Also apply on page load if modal is already open
    addColorIndicatorsToDropdown();
});