import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupMonaco } from './tdsl-language';
import './styles.css';

setupMonaco();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
