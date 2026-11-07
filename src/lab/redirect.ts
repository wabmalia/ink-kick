// #/lab opens the lab: built and deployed with the game, but not linked from
// anywhere, so only someone who knows the address finds it.
const toLab = () => {
  if (location.hash.startsWith('#/lab')) location.replace('lab.html');
};
toLab();
window.addEventListener('hashchange', toLab);

export {};
