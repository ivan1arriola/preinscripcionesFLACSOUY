import React from 'react';
import { HELP_EMAIL } from '../content/form-copy.js';

export const FormHelp: React.FC = () => (
  <aside className="form-help" aria-label="Ayuda">
    <span className="form-help__icon" aria-hidden="true">?</span>
    <p>
      ¿Necesitás ayuda con tu preinscripción? Escribinos a{' '}
      <a href={`mailto:${HELP_EMAIL}`}>{HELP_EMAIL}</a> y te respondemos.
    </p>
  </aside>
);
