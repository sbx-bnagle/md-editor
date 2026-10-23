import { useEffect, useState } from 'react';
import { FILES_APP, api } from '../api/host';
import { chooseLibraryDialog, openLibrary } from '../state/actions';

export function Welcome() {
  const [defaultPath, setDefaultPath] = useState('');
  useEffect(() => {
    api.app.defaultLibraryPath().then(setDefaultPath);
  }, []);
  return (
    <div className="welcome drag">
      <div className="welcome-card no-drag">
        <h1>Folio Dome</h1>
        <p>Your library is a folder of collections, projects, templates, and themes. Everything is stored as plain files you can open in {FILES_APP}.</p>
        <button className="button primary large" onClick={() => openLibrary(defaultPath, true)} disabled={!defaultPath}>
          Create Library
        </button>
        <div className="welcome-path">{defaultPath}</div>
        <button className="link-button" onClick={chooseLibraryDialog}>
          Choose another folder…
        </button>
      </div>
    </div>
  );
}
