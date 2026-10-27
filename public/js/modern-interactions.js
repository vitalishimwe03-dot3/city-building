// Modern Interactive Features
document.addEventListener("DOMContentLoaded", function() {
  // Navbar scroll effect
  const navbar = document.getElementById("mainNavbar");
  if (navbar) {
    window.addEventListener("scroll", function() {
      if (window.scrollY > 50) {
        navbar.classList.add("scrolled");
      } else {
        navbar.classList.remove("scrolled");
      }
    });
  }

  // Scroll reveal animation
  const revealElements = document.querySelectorAll(".reveal");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px"
  });

  revealElements.forEach(el => {
    revealObserver.observe(el);
  });

  // Smooth scroll for anchor links
  document.querySelectorAll("a[href^=\"#\"]").forEach(anchor => {
    anchor.addEventListener("click", function (e) {
      const target = document.querySelector(this.getAttribute("href"));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });

  // Card tilt effect on hover
  const cards = document.querySelectorAll(".card, .category-card, .course-card");
  cards.forEach(card => {
    card.addEventListener("mousemove", function(e) {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = (y - centerY) / 20;
      const rotateY = (centerX - x) / 20;
      
      card.style.transform = "perspective(1000px) rotateX(" + rotateX + "deg) rotateY(" + rotateY + "deg) translateY(-4px)";
    });
    
    card.addEventListener("mouseleave", function() {
      card.style.transform = "perspective(1000px) rotateX(0) rotateY(0) translateY(0)";
    });
  });

  // Button ripple effect
  const buttons = document.querySelectorAll(".btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", function(e) {
      const ripple = document.createElement("span");
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      ripple.classList.add("ripple");
      
      btn.appendChild(ripple);
      
      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Add ripple styles
  const style = document.createElement("style");
  style.textContent = ".btn { position: relative; overflow: hidden; } .ripple { position: absolute; border-radius: 50%; background: rgba(255, 255, 255, 0.6); transform: scale(0); animation: ripple-animation 0.6s ease-out; pointer-events: none; } @keyframes ripple-animation { to { transform: scale(4); opacity: 0; } }";
  document.head.appendChild(style);

  // Parallax effect for hero
  const hero = document.querySelector(".hero");
  if (hero) {
    window.addEventListener("scroll", function() {
      const scrolled = window.pageYOffset;
      const parallax = hero.querySelector(".hero-content");
      if (parallax) {
        parallax.style.transform = "translateY(" + (scrolled * 0.5) + "px)";
        parallax.style.opacity = 1 - scrolled / 600;
      }
    });
  }

  // Animated counter for stats
  const stats = document.querySelectorAll(".hero-stat h3, .stat-number");
  const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target;
        const text = target.textContent;
        const number = parseInt(text.replace(/[^0-9]/g, ""));
        if (!isNaN(number)) {
          let current = 0;
          const increment = number / 50;
          const suffix = text.replace(/[0-9]/g, "");
          const timer = setInterval(() => {
            current += increment;
            if (current >= number) {
              target.textContent = number + suffix;
              clearInterval(timer);
            } else {
              target.textContent = Math.floor(current) + suffix;
            }
          }, 30);
        }
        statsObserver.unobserve(target);
      }
    });
  }, { threshold: 0.5 });

  stats.forEach(stat => {
    statsObserver.observe(stat);
  });
});
