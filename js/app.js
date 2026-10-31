// Función para cambiar el color personalizado de la interfaz
function cambiarColorAcento(nuevoColorHex) {
    document.documentElement.style.setProperty('--accent-color', nuevoColorHex);
}

// Ejemplo: Si añades un input de color en tu HTML, podrías cambiarlo así:
// <input type="color" id="colorPicker">
const picker = document.getElementById('colorPicker');
if(picker) {
    picker.addEventListener('input', (e) => {
        cambiarColorAcento(e.target.value);
    });
}
