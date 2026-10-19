import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element');

new App(root);

if (import.meta.env.PROD) {
  // Updates wait for the next launch so they can never interrupt a run.
  registerSW({ immediate: true });
}
