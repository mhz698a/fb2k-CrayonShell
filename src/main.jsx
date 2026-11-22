import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/main.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('No se encontró el elemento raíz de CrayonShell.');
}

createRoot(rootElement).render(<App />);
