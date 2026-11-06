import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '../ui/theme/legacy-tokens.css';
import './team-web.css';
import {AppearanceProvider} from '../ui/Appearance';
import {TeamWebApp} from './TeamWebApp';

createRoot(document.getElementById('root')!).render(
 <StrictMode>
  <AppearanceProvider>
   <TeamWebApp/>
  </AppearanceProvider>
 </StrictMode>,
);
