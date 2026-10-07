import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('DrawSounds could not find the #root mount element.');
}
createRoot(rootElement).render(<App />);
