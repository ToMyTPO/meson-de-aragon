// Menú móvil
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
toggle.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});
links.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  })
);

// Carrusel de portada
const slides = document.querySelectorAll('.hero-slide');
let current = 0;
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  setInterval(() => {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 6000);
}

// Galería de imágenes
const range = (prefix, nums) => nums.map(n => `img/${prefix}-${String(n).padStart(2, '0')}.jpg`);
const albums = [
  { cat: 'Exteriores', title: 'Mesón de Aragón', imgs: range('exterior', [1, 2, 3, 4, 5, 6, 7]) },
  { cat: 'Comedor', title: 'El ambiente, parte fundamental', imgs: range('comedor', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) },
  { cat: 'Restaurante', title: 'Buen provecho', imgs: range('restaurante', [1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14]) },
  { cat: 'Bodega', title: 'Sabor e historia', imgs: range('bodega', [1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  { cat: 'Cafetería', title: 'Tu espacio, tus tapas', imgs: range('cafeteria', [1, 2, 3, 4]) },
];
const tabsEl = document.querySelector('.gallery-tabs');
const galleryEl = document.getElementById('gallery');
let active = albums[0];

function renderGallery(album) {
  active = album;
  tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.textContent === album.cat));
  galleryEl.innerHTML = album.imgs
    .map((src, i) => `<button data-i="${i}" aria-label="Ampliar imagen ${i + 1}"><img src="${src}" alt="${album.cat} ${i + 1}" loading="lazy"></button>`)
    .join('');
}
albums.forEach(a => {
  const b = document.createElement('button');
  b.className = 'tab';
  b.textContent = a.cat;
  b.addEventListener('click', () => renderGallery(a));
  tabsEl.appendChild(b);
});
renderGallery(albums[0]);

// Lightbox
const lb = document.getElementById('lightbox');
const lbImg = lb.querySelector('img');
let lbIndex = 0;
const showLb = i => {
  lbIndex = (i + active.imgs.length) % active.imgs.length;
  lbImg.src = active.imgs[lbIndex];
  lbImg.alt = `${active.cat} ${lbIndex + 1}`;
  lb.hidden = false;
};
galleryEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) showLb(Number(btn.dataset.i));
});
lb.querySelector('.lb-close').addEventListener('click', () => (lb.hidden = true));
lb.querySelector('.lb-prev').addEventListener('click', () => showLb(lbIndex - 1));
lb.querySelector('.lb-next').addEventListener('click', () => showLb(lbIndex + 1));
lb.addEventListener('click', e => { if (e.target === lb) lb.hidden = true; });
document.addEventListener('keydown', e => {
  if (lb.hidden) return;
  if (e.key === 'Escape') lb.hidden = true;
  if (e.key === 'ArrowLeft') showLb(lbIndex - 1);
  if (e.key === 'ArrowRight') showLb(lbIndex + 1);
});

// Formulario: abre el correo del cliente con la solicitud ya redactada
const form = document.getElementById('reserva-form');
form.addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const subject = `Solicitud de reserva: ${d.tipo}`;
  const body =
    `Nombre: ${d.nombre}\nTeléfono: ${d.telefono}\nReserva: ${d.tipo}\nFecha: ${d.fecha}\n\n${d.comentarios || ''}`;
  window.location.href =
    `mailto:meson@mesondearagon.es?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  form.querySelector('.form-msg').textContent =
    'Se ha abierto su programa de correo con la solicitud. También puede llamarnos al 976 124 264.';
});

// Animación al hacer scroll
const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.section .container > *').forEach(el => {
  el.classList.add('reveal');
  io.observe(el);
});

document.getElementById('year').textContent = new Date().getFullYear();
