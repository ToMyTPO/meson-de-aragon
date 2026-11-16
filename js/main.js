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

// Pestañas de la carta
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.menu-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Formulario de reserva: abre WhatsApp con los datos (sin backend)
const form = document.getElementById('reserva-form');
form.addEventListener('submit', e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const text =
    `Hola, quería reservar mesa en Mesón de Aragón.%0A` +
    `Nombre: ${encodeURIComponent(d.nombre)}%0A` +
    `Teléfono: ${encodeURIComponent(d.telefono)}%0A` +
    `Fecha: ${encodeURIComponent(d.fecha)}%0A` +
    `Personas: ${encodeURIComponent(d.personas)}%0A` +
    (d.comentarios ? `Comentarios: ${encodeURIComponent(d.comentarios)}` : '');
  // TODO: confirmar el número de WhatsApp del restaurante
  window.open(`https://wa.me/34976124264?text=${text}`, '_blank');
  form.querySelector('.form-msg').textContent =
    'Te hemos abierto WhatsApp con tu solicitud. También puedes llamarnos al 976 12 42 64.';
});

// Animación al hacer scroll
const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.section .container > *').forEach(el => {
  el.classList.add('reveal');
  io.observe(el);
});

document.getElementById('year').textContent = new Date().getFullYear();
