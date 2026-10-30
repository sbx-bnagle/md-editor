// The page sign-in services send the user back to. In a pop-up (Google), it hands the result to the
// app's window and closes; after a full-page sign-in (Dropbox), it keeps the result for the app and
// goes back to it.
(function () {
  var params = new URLSearchParams(location.search.slice(1));
  new URLSearchParams(location.hash.slice(1)).forEach(function (v, k) {
    params.set(k, v);
  });
  var text = params.toString();
  var opener = null;
  try {
    opener = window.opener && window.opener.location.origin === location.origin ? window.opener : null;
  } catch (e) {}
  if (opener) {
    opener.postMessage({ type: 'folio-oauth', params: text }, location.origin);
    window.close();
    return;
  }
  sessionStorage.setItem('folio.oauth.return', text);
  var pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem('folio.dropbox.pending') || 'null');
  } catch (e) {}
  location.replace((pending && pending.back) || './');
})();
