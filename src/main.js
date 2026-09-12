import { createApp } from 'vue';
import { CdxButton, CdxField, CdxMessage, CdxSelect, CdxTextInput } from '@wikimedia/codex';
import '@wikimedia/codex/dist/codex.style.css';
import App from './App.vue';

createApp(App)
  .component('CdxButton', CdxButton)
  .component('CdxField', CdxField)
  .component('CdxMessage', CdxMessage)
  .component('CdxSelect', CdxSelect)
  .component('CdxTextInput', CdxTextInput)
  .mount('#app');
