// ===== SIDEBAR TOGGLE =====
const sidebar       = document.getElementById('sidebar');
const toggleBtn     = document.getElementById('sidebarToggle');
const closeBtn      = document.getElementById('sidebarCloseBtn');
const SIDEBAR_KEY   = 'kroxy_sidebar_open';

function openSidebar()  { sidebar && sidebar.classList.add('open');    localStorage.setItem(SIDEBAR_KEY, '1'); }
function closeSidebar() { sidebar && sidebar.classList.remove('open'); localStorage.setItem(SIDEBAR_KEY, '0'); }
function toggleSidebar(){ sidebar && sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); }

// Restore state on desktop
if (sidebar) {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) {
    // Desktop: always open by default unless explicitly closed
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== '0') openSidebar();
    // on desktop wrap shifts on open
  } else {
    // Mobile: starts closed
    closeSidebar();
  }
}

if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
if (closeBtn)  closeBtn.addEventListener('click',  closeSidebar);

// Close on outside click (mobile)
document.addEventListener('click', (e) => {
  if (window.innerWidth > 768) return;
  if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggleBtn) {
    closeSidebar();
  }
});

// ===== PASSWORD TOGGLE =====
function togglePwd(id, btn) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.style.opacity = input.type === 'text' ? '1' : '0.5';
}

// ===== AUTO DISMISS FLASH =====
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .5s'; }, 4000);
  setTimeout(() => el.remove(), 4500);
});

// ===== GENERIC COPY =====
function copyText(text, el) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  if (el) {
    const orig = el.textContent;
    el.textContent = 'copied!';
    setTimeout(() => el.textContent = orig, 1000);
  }
}
