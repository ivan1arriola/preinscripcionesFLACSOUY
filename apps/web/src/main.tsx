import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import './app.css';
import './form.css';
import App from './App';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
