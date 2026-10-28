import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './app.css';
import './form.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
