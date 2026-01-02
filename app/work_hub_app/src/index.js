import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@ui5/webcomponents-react';
import '@ui5/webcomponents/dist/Assets.js';
import '@ui5/webcomponents-fiori/dist/Assets.js';
import '@ui5/webcomponents-icons/dist/AllIcons.js';
import "@ui5/webcomponents-base/dist/DragAndDrop.js";
import { ModelProvider } from './model/ModelProvider';
import { I18nProvider } from './i18n/useI18n';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <I18nProvider defaultLanguage="ko">
      <ModelProvider>
        <App />
      </ModelProvider>
    </I18nProvider>
  </ThemeProvider>
);

