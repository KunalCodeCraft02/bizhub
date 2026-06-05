// =========================
// NAVBAR SCROLL EFFECT
// =========================
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
  if (window.scrollY > 50) {
    navbar?.classList.add('scrolled');
  } else {
    navbar?.classList.remove('scrolled');
  }
});


// =========================
// TAB SWITCHER (LOGIN + SIGNUP)
// =========================
const tabButtons = document.querySelectorAll('.tab-btn');
const formPanels = document.querySelectorAll('.form-panel');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;

    // active button
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // show corresponding panel
    formPanels.forEach(panel => {
      panel.classList.remove('active');
      if (panel.dataset.content === tab) {
        panel.classList.add('active');
      }
    });
  });
});


// =========================
// PASSWORD SHOW/HIDE
// =========================
document.querySelectorAll('.password-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const input = toggle.previousElementSibling;

    if (input.type === 'password') {
      input.type = 'text';
      toggle.textContent = '🙈';
    } else {
      input.type = 'password';
      toggle.textContent = '👁';
    }
  });
});


// =========================
// OTP FLOW (SIGNUP)
// =========================
document.querySelectorAll('.send-otp-btn').forEach(button => {
  button.addEventListener('click', () => {

    const parent = button.closest('.form-panel');
    const otpSection = parent.querySelector('.otp-section');

    // show OTP input
    otpSection.classList.add('active');

    let timeLeft = 60;
    button.disabled = true;
    button.textContent = `Resend in ${timeLeft}s`;

    const timer = setInterval(() => {
      timeLeft--;
      button.textContent = `Resend in ${timeLeft}s`;

      if (timeLeft <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = 'Resend OTP';
      }
    }, 1000);
  });
});


// =========================
// COUNTER ANIMATION (HOMEPAGE)
// =========================
const counters = document.querySelectorAll('[data-target]');

const counterObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = +el.dataset.target;
      let count = 0;
      const duration = 2000;
      const increment = target / (duration / 16);

      const update = () => {
        count += increment;
        if (count < target) {
          el.textContent = Math.floor(count);
          requestAnimationFrame(update);
        } else {
          el.textContent = target + '+';
        }
      };

      update();
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

counters.forEach(counter => counterObserver.observe(counter));


// =========================
// TIMELINE ANIMATION
// =========================
const timelineItems = document.querySelectorAll('.timeline-item');

const timelineObserver = new IntersectionObserver(entries => {
  entries.forEach((entry, index) => {
    if (entry.isIntersecting) {
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, index * 150);
      timelineObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });

timelineItems.forEach(item => timelineObserver.observe(item));


// =========================
// HAMBURGER MENU
// =========================
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');

hamburger?.addEventListener('click', () => {
  hamburger.classList.toggle('active');
  navLinks.classList.toggle('nav-open');
});


// =========================
// SMOOTH SCROLL
// =========================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();

    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});