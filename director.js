/**
 * ============================================================================
 * SISTEMA EMPRESARIAL DE CONTROL DE ASISTENCIA ESCOLAR QR - LÓGICA DIRECTOR
 * Archivo: director.js
 * ============================================================================
 */

let listaAlumnosGlobal = [];
let listaAsistenciasGlobal = [];
let gradoFiltroCarnets = "TODOS";
let chartGradosInstance = null;
let chartDonaInstance = null;
let primeraCargaAsistencias = true;
let ultimoIdNotificado = null;

const GRADOS_PRIMARIA = [
  "1° Primaria",
  "2° Primaria",
  "3° Primaria",
  "4° Primaria",
  "5° Primaria",
  "6° Primaria"
];

document.addEventListener("DOMContentLoaded", () => {
  inicializarTema();
  iniciarRelojDigital();

  const inputFecha = document.getElementById("filtroFechaReporte");
  if (inputFecha) {
    inputFecha.value = obtenerFechaHoyISO();
  }

  // 1. Escuchar Configuración del Colegio en Firestore
  escucharConfiguracion((cfg) => {
    aplicarConfiguracionEnUI(cfg);
    renderizarCarnets();
  });

  // 2. Escuchar Padrón de Alumnos en Firestore
  escucharAlumnos((alumnos) => {
    listaAlumnosGlobal = alumnos;
    actualizarDashboardEnVivo();
    renderizarCarnets();
    renderizarTablaReportes();
  });

  // 3. Escuchar Colección de Asistencias en Tiempo Real
  iniciarEscuchaAsistencias();

  // Actualizar colores de Chart.js al cambiar modo claro/oscuro
  window.addEventListener("themeChanged", () => {
    actualizarGraficosEstadisticos();
  });
});

// ============================================================================
// NAVEGACIÓN ENTRE PESTAÑAS Y SIDEBAR
// ============================================================================
function cambiarPestana(tabId, btnElement) {
  document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("active"));
  document.querySelectorAll(".sidebar-nav .nav-item").forEach((btn) => btn.classList.remove("active"));

  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");
  if (btnElement) btnElement.classList.add("active");

  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.remove("mobile-open");
  }

  if (tabId === "tab-dashboard") {
    actualizarGraficosEstadisticos();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle("mobile-open");
  } else {
    sidebar.classList.toggle("collapsed");
  }
}

function iniciarRelojDigital() {
  const el = document.getElementById("headerClock");
  const tick = () => {
    if (el) el.textContent = obtenerHoraActualLegible(new Date());
  };
  tick();
  setInterval(tick, 1000);
}

// ============================================================================
// APLICAR CONFIGURACIÓN INSTITUCIONAL EN LA INTERFAZ
// ============================================================================
function aplicarConfiguracionEnUI(cfg) {
  document.querySelectorAll(".js-school-name").forEach((el) => {
    el.textContent = cfg.nombre;
  });
  document.querySelectorAll(".js-school-motto").forEach((el) => {
    el.textContent = cfg.lema;
  });
  document.querySelectorAll(".js-school-logo").forEach((img) => {
    img.src = cfg.logo || DEFAULT_LOGO_BASE64;
  });

  const fav = document.getElementById("dynamicFavicon");
  if (fav) {
    fav.href = cfg.logo || "logo.jpeg";
  }

  const inputNombre = document.getElementById("cfgNombreColegio");
  const inputLema = document.getElementById("cfgLemaColegio");
  const inputHora = document.getElementById("cfgHoraLimite");
  const inputTol = document.getElementById("cfgTolerancia");

  if (inputNombre && document.activeElement !== inputNombre) inputNombre.value = cfg.nombre;
  if (inputLema && document.activeElement !== inputLema) inputLema.value = cfg.lema;
  if (inputHora && document.activeElement !== inputHora) inputHora.value = cfg.horaLimite;
  if (inputTol && document.activeElement !== inputTol) inputTol.value = cfg.tolerancia;
}

// ============================================================================
// ESCUCHA EN TIEMPO REAL DE ASISTENCIAS (onSnapshot)
// ============================================================================
function iniciarEscuchaAsistencias() {
  db.collection("asistencias")
    .orderBy("timestamp", "desc")
    .onSnapshot((snapshot) => {
      const registros = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const Normalizado = normalizarRegistroAsistencia(doc.id, data);
        registros.push(Normalizado);
      });

      // Detectar nuevo ingreso en vivo para sonar y mostrar toast
      if (!primeraCargaAsistencias && registros.length > 0) {
        const masReciente = registros[0];
        if (masReciente.id !== ultimoIdNotificado && masReciente.fechaISO === obtenerFechaHoyISO()) {
          ultimoIdNotificado = masReciente.id;
          AudioFX.beepExito();
          mostrarToast(
            `Nuevo ingreso: ${masReciente.nombre}`,
            `${masReciente.grado} • ${masReciente.hora} (${masReciente.estado})`,
            masReciente.estado === "TARDANZA" ? "warning" : "success"
          );
        }
      } else if (registros.length > 0) {
        ultimoIdNotificado = registros[0].id;
      }
      primeraCargaAsistencias = false;

      listaAsistenciasGlobal = registros;
      actualizarDashboardEnVivo();
      renderizarTablaReportes();
    }, (error) => {
      console.error("Error en onSnapshot de asistencias:", error);
      mostrarToast("Error de conexión", "No se pudo sincronizar con Firestore", "error");
    });
}

function normalizarRegistroAsistencia(id, data) {
  const codigo = data.codigo || extraerCodigoDeTexto(data.alumno) || "PRI-000";
  const alumnoMatch = listaAlumnosGlobal.find((a) => a.codigo === codigo);
  const nombre = data.nombre || (alumnoMatch ? alumnoMatch.nombre : (data.alumno || "Estudiante"));
  const grado = data.grado || (alumnoMatch ? alumnoMatch.grado : "Primaria");
  const telefono = data.telefono || (alumnoMatch ? alumnoMatch.telefono : "51987654301");
  const fechaISO = data.fechaISO || convertirFechaLegibleAISO(data.fecha) || obtenerFechaHoyISO();
  const fechaLegible = data.fecha || formatearFechaISOaLegible(fechaISO);
  const hora = data.hora || "--:--:--";
  const estado = (data.estado || "PUNTUAL").toUpperCase();

  return {
    id,
    codigo,
    nombre,
    grado,
    telefono,
    fechaISO,
    fecha: fechaLegible,
    hora,
    estado
  };
}

function extraerCodigoDeTexto(str = "") {
  const m = String(str).match(/PRI-\d{3}/i);
  return m ? m[0].toUpperCase() : "";
}

function convertirFechaLegibleAISO(fechaStr = "") {
  if (!fechaStr || !fechaStr.includes("/")) return "";
  const partes = fechaStr.split("/");
  if (partes.length !== 3) return "";
  const [dd, mm, yyyy] = partes;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// ============================================================================
// PESTAÑA 1: DASHBOARD EN VIVO, KPIs Y GRÁFICOS CHART.JS
// ============================================================================
function obtenerAsistenciasDeFecha(fechaISO) {
  return listaAsistenciasGlobal.filter((r) => r.fechaISO === fechaISO);
}

function actualizarDashboardEnVivo() {
  const hoyISO = obtenerFechaHoyISO();
  const asistenciasHoy = obtenerAsistenciasDeFecha(hoyISO);

  // Alumnos únicos presentes hoy
  const mapPresentes = new Map();
  asistenciasHoy.forEach((reg) => {
    if (!mapPresentes.has(reg.codigo)) {
      mapPresentes.set(reg.codigo, reg);
    }
  });

  const totalMatriculados = listaAlumnosGlobal.length || 30;
  const totalPresentes = mapPresentes.size;
  let totalTardanzas = 0;
  let totalPuntuales = 0;

  mapPresentes.forEach((reg) => {
    if (reg.estado === "TARDANZA") {
      totalTardanzas++;
    } else {
      totalPuntuales++;
    }
  });

  const totalAusentes = Math.max(0, totalMatriculados - totalPresentes);

  // Actualizar KPIs
  document.getElementById("kpiMatriculados").textContent = totalMatriculados;
  document.getElementById("kpiAsistenciasHoy").textContent = totalPresentes;
  document.getElementById("kpiTardanzasHoy").textContent = totalTardanzas;
  document.getElementById("kpiAusentesHoy").textContent = totalAusentes;

  const pctAsis = totalMatriculados > 0 ? Math.round((totalPresentes / totalMatriculados) * 100) : 0;
  const pctTard = totalPresentes > 0 ? Math.round((totalTardanzas / totalPresentes) * 100) : 0;
  const pctAus = totalMatriculados > 0 ? Math.round((totalAusentes / totalMatriculados) * 100) : 0;

  document.getElementById("kpiPorcentajeAsistencia").textContent = `${pctAsis}% del total`;
  document.getElementById("kpiPorcentajeTardanza").textContent = `${pctTard}% de ingresos`;
  document.getElementById("kpiPorcentajeAusentes").textContent = `${pctAus}% faltan`;

  // Actualizar Tarjeta Destacada "Último Ingreso"
  if (asistenciasHoy.length > 0) {
    const ultimo = asistenciasHoy[0];
    document.getElementById("heroAvatar").textContent = obtenerIniciales(ultimo.nombre);
    document.getElementById("heroNombre").textContent = ultimo.nombre;
    document.getElementById("heroGrado").innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${ultimo.grado}`;
    document.getElementById("heroCodigo").innerHTML = `<i class="fa-solid fa-barcode"></i> ${ultimo.codigo}`;
    document.getElementById("heroHora").textContent = ultimo.hora;
    document.getElementById("heroBadgeEstado").innerHTML = renderizarBadgeEstado(ultimo.estado);
  } else {
    document.getElementById("heroAvatar").textContent = "QR";
    document.getElementById("heroNombre").textContent = "Esperando escaneo en puerta...";
    document.getElementById("heroGrado").innerHTML = `<i class="fa-solid fa-graduation-cap"></i> Sin ingresos registrados hoy`;
    document.getElementById("heroCodigo").innerHTML = `<i class="fa-solid fa-barcode"></i> ---`;
    document.getElementById("heroHora").textContent = "--:--:--";
    document.getElementById("heroBadgeEstado").innerHTML = `<span class="badge-status badge-justificado">EN ESPERA</span>`;
  }

  // Renderizar Tabla en Tiempo Real
  const tbody = document.getElementById("tablaVivoBody");
  if (asistenciasHoy.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:28px; color:var(--text-secondary);">
          <i class="fa-solid fa-qrcode" style="font-size:1.5rem; display:block; margin-bottom:8px; color:var(--primary);"></i>
          Aún no se han registrado ingresos hoy. Escanea un carnet desde <strong>escanear.html</strong> o pulsa "Simular Ingreso QR".
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = asistenciasHoy.slice(0, 15).map((reg) => {
      const waUrl = construirUrlWhatsApp(reg.telefono, reg.nombre, reg.grado, reg.fecha, reg.hora, reg.estado);
      return `
        <tr>
          <td>
            <div class="student-cell">
              <div class="avatar-circle" style="background:${obtenerColorAvatar(reg.codigo)}">
                ${obtenerIniciales(reg.nombre)}
              </div>
              <div>
                <div style="font-weight:700;">${reg.nombre}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">Apoderado: +${reg.telefono}</div>
              </div>
            </div>
          </td>
          <td><span class="code-pill">${reg.codigo}</span></td>
          <td><strong>${reg.grado}</strong></td>
          <td style="font-variant-numeric:tabular-nums; font-weight:700;">${reg.hora}</td>
          <td>${renderizarBadgeEstado(reg.estado)}</td>
          <td>
            <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm" title="Notificar por WhatsApp al Apoderado">
              <i class="fa-brands fa-whatsapp"></i> Notificar
            </a>
          </td>
        </tr>
      `;
    }).join("");
  }

  actualizarGraficosEstadisticos(mapPresentes, totalPuntuales, totalTardanzas, totalAusentes);
}

function renderizarBadgeEstado(estado) {
  const est = (estado || "PUNTUAL").toUpperCase();
  if (est === "TARDANZA") {
    return `<span class="badge-status badge-tardanza"><i class="fa-solid fa-clock"></i> TARDANZA</span>`;
  }
  if (est === "JUSTIFICADO") {
    return `<span class="badge-status badge-justificado"><i class="fa-solid fa-file-shield"></i> JUSTIFICADO</span>`;
  }
  if (est === "AUSENTE") {
    return `<span class="badge-status badge-ausente"><i class="fa-solid fa-user-xmark"></i> AUSENTE</span>`;
  }
  return `<span class="badge-status badge-puntual"><i class="fa-solid fa-circle-check"></i> PUNTUAL</span>`;
}

function actualizarGraficosEstadisticos(mapPresentesParam, puntualesParam, tardanzasParam, ausentesParam) {
  const hoyISO = obtenerFechaHoyISO();
  const asistenciasHoy = obtenerAsistenciasDeFecha(hoyISO);

  const mapPresentes = mapPresentesParam || new Map();
  if (!mapPresentesParam) {
    asistenciasHoy.forEach((r) => {
      if (!mapPresentes.has(r.codigo)) mapPresentes.set(r.codigo, r);
    });
  }

  const conteoPorGrado = GRADOS_PRIMARIA.map((grado) => {
    let cuenta = 0;
    mapPresentes.forEach((reg) => {
      if (reg.grado === grado) cuenta++;
    });
    return cuenta;
  });

  let puntuales = puntualesParam ?? 0;
  let tardanzas = tardanzasParam ?? 0;
  if (puntualesParam === undefined) {
    mapPresentes.forEach((reg) => {
      if (reg.estado === "TARDANZA") tardanzas++;
      else puntuales++;
    });
  }
  const totalMatriculados = listaAlumnosGlobal.length || 30;
  const ausentes = ausentesParam ?? Math.max(0, totalMatriculados - mapPresentes.size);

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const textColor = isDark ? "#cbd5e1" : "#475569";
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.06)";

  // 1. Gráfico de Barras por Grado
  const ctxBar = document.getElementById("chartGrados");
  if (ctxBar) {
    if (chartGradosInstance) chartGradosInstance.destroy();
    chartGradosInstance = new Chart(ctxBar, {
      type: "bar",
      data: {
        labels: GRADOS_PRIMARIA,
        datasets: [
          {
            label: "Alumnos Presentes Hoy",
            data: conteoPorGrado,
            backgroundColor: [
              "rgba(37, 99, 235, 0.85)",
              "rgba(16, 185, 129, 0.85)",
              "rgba(124, 58, 237, 0.85)",
              "rgba(245, 158, 11, 0.85)",
              "rgba(14, 165, 233, 0.85)",
              "rgba(236, 72, 153, 0.85)"
            ],
            borderRadius: 10,
            maxBarThickness: 44
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 6,
            ticks: { stepSize: 1, color: textColor },
            grid: { color: gridColor }
          },
          x: {
            ticks: { color: textColor },
            grid: { display: false }
          }
        }
      }
    });
  }

  // 2. Gráfico de Dona (Puntuales vs Tardanzas vs Faltas)
  const ctxDona = document.getElementById("chartDona");
  if (ctxDona) {
    if (chartDonaInstance) chartDonaInstance.destroy();
    chartDonaInstance = new Chart(ctxDona, {
      type: "doughnut",
      data: {
        labels: ["Puntuales", "Tardanzas", "Faltas / Por llegar"],
        datasets: [
          {
            data: [puntuales, tardanzas, ausentes],
            backgroundColor: ["#10b981", "#ef4444", "#f59e0b"],
            borderWidth: 0,
            hoverOffset: 8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: textColor, padding: 16, font: { weight: "600" } }
          }
        }
      }
    });
  }
}

// Botón de demostración para simular un ingreso real en Firestore
async function simularIngresoAleatorio() {
  if (listaAlumnosGlobal.length === 0) return;
  const hoyISO = obtenerFechaHoyISO();
  const presentesHoy = new Set(obtenerAsistenciasDeFecha(hoyISO).map((r) => r.codigo));
  const disponibles = listaAlumnosGlobal.filter((a) => !presentesHoy.has(a.codigo));

  if (disponibles.length === 0) {
    mostrarToast("Asistencia Completa", "Todos los alumnos matriculados ya registraron su ingreso hoy.", "info");
    return;
  }

  const elegido = disponibles[Math.floor(Math.random() * disponibles.length)];
  const ahora = new Date();
  const estado = evaluarEstadoHorario(ahora, window.CONFIG_COLEGIO);

  await db.collection("asistencias").add({
    codigo: elegido.codigo,
    nombre: elegido.nombre,
    alumno: `${elegido.codigo} - ${elegido.nombre}`,
    grado: elegido.grado,
    telefono: elegido.telefono,
    fechaISO: hoyISO,
    fecha: formatearFechaISOaLegible(hoyISO),
    hora: obtenerHoraActualLegible(ahora),
    estado: estado,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ============================================================================
// PESTAÑA 2: GESTIÓN DE ALUMNOS Y GENERADOR DE CARNETS PRO (qr-code-styling)
// ============================================================================
function filtrarCarnetsGrado(grado, btnEl) {
  gradoFiltroCarnets = grado;
  document.querySelectorAll("#filtrosGradoCarnets .filter-pill").forEach((b) => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  renderizarCarnets();
}

function renderizarCarnets() {
  const contenedor = document.getElementById("contenedorCarnets");
  if (!contenedor) return;

  const busqueda = (document.getElementById("buscadorCarnets")?.value || "").trim().toLowerCase();

  const filtrados = listaAlumnosGlobal.filter((al) => {
    const pasaGrado = gradoFiltroCarnets === "TODOS" || al.grado === gradoFiltroCarnets;
    const pasaTexto =
      !busqueda ||
      (al.nombre && al.nombre.toLowerCase().includes(busqueda)) ||
      (al.codigo && al.codigo.toLowerCase().includes(busqueda));
    return pasaGrado && pasaTexto;
  });

  if (filtrados.length === 0) {
    contenedor.innerHTML = `
      <div class="card-panel" style="grid-column: 1 / -1; text-align:center; padding:32px; color:var(--text-secondary);">
        No se encontraron alumnos con el filtro seleccionado.
      </div>
    `;
    return;
  }

  const colegioNombre = window.CONFIG_COLEGIO?.nombre || "I.E.P. Dayiva School";
  const colegioLogo = window.CONFIG_COLEGIO?.logo || DEFAULT_LOGO_BASE64;

  contenedor.innerHTML = filtrados.map((alumno) => `
    <div class="carnet-card" id="carnet-${alumno.codigo}">
      <div class="carnet-header">
        <div class="carnet-pvc-slot"></div>
        <div class="carnet-header-top">
          <img src="${colegioLogo}" alt="Escudo ${colegioNombre}" />
          <div class="carnet-school-title">${colegioNombre}</div>
        </div>
      </div>

      <div class="carnet-avatar-wrap">
        <div class="carnet-avatar" style="background:${obtenerColorAvatar(alumno.codigo)}">
          ${obtenerIniciales(alumno.nombre)}
        </div>
      </div>

      <div class="carnet-body">
        <div class="carnet-student-name">${alumno.nombre}</div>
        <span class="carnet-grade-badge">${alumno.grado}</span>

        <div class="carnet-qr-box" id="qr-box-${alumno.codigo}"></div>

        <div class="carnet-id-bar">${alumno.codigo}</div>
        <div class="carnet-parent-phone">
          <i class="fa-brands fa-whatsapp" style="color:#16a34a;"></i> Apoderado: +${alumno.telefono}
        </div>
      </div>

      <div class="carnet-actions no-print">
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="imprimirCarnetIndividual('${alumno.codigo}')">
          <i class="fa-solid fa-print"></i> Imprimir Carnet
        </button>
        <button class="btn btn-danger btn-sm" onclick="eliminarAlumno('${alumno.codigo}', '${alumno.nombre.replace(/'/g, "\\'")}')" title="Eliminar Alumno">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join("");

  // Generar cada QR estilizado con qr-code-styling
  filtrados.forEach((alumno) => {
    const qrContainer = document.getElementById(`qr-box-${alumno.codigo}`);
    if (qrContainer && typeof QRCodeStyling !== "undefined") {
      qrContainer.innerHTML = "";
      const qrCode = new QRCodeStyling({
        width: 156,
        height: 156,
        type: "canvas",
        data: alumno.codigo,
        image: colegioLogo,
        margin: 2,
        qrOptions: {
          errorCorrectionLevel: "H"
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.36,
          margin: 3,
          crossOrigin: "anonymous"
        },
        dotsOptions: {
          color: "#1e3a8a",
          type: "rounded"
        },
        cornersSquareOptions: {
          color: "#d97706",
          type: "extra-rounded"
        },
        cornersDotOptions: {
          color: "#1d4ed8",
          type: "dot"
        },
        backgroundOptions: {
          color: "#ffffff"
        }
      });
      qrCode.append(qrContainer);
    }
  });
}

async function registrarNuevoAlumno(event) {
  event.preventDefault();
  const nombre = document.getElementById("inputNombreAlumno").value.trim();
  const grado = document.getElementById("inputGradoAlumno").value;
  const telefono = document.getElementById("inputTelefonoPadre").value.trim().replace(/\D/g, "");

  if (!nombre || !telefono) return;

  // Generar siguiente código PRI-XXX correlativo
  let maxNum = 30;
  listaAlumnosGlobal.forEach((a) => {
    const m = String(a.codigo || "").match(/PRI-(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nuevoCodigo = `PRI-${String(maxNum + 1).padStart(3, "0")}`;

  try {
    await db.collection("alumnos").doc(nuevoCodigo).set({
      codigo: nuevoCodigo,
      nombre,
      grado,
      telefono,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById("formNuevoAlumno").reset();
    mostrarToast("Alumno Matriculado", `${nombre} (${nuevoCodigo}) agregado con éxito.`, "success");
  } catch (err) {
    console.error("Error al matricular alumno:", err);
    mostrarToast("Error", "No se pudo guardar el alumno en Firebase.", "error");
  }
}

async function eliminarAlumno(codigo, nombre) {
  if (!confirm(`¿Deseas eliminar del padrón al alumno ${nombre} (${codigo})?`)) return;
  try {
    await db.collection("alumnos").doc(codigo).delete();
    mostrarToast("Alumno Eliminado", `Se eliminó el carnet ${codigo}.`, "warning");
  } catch (err) {
    console.error("Error eliminando alumno:", err);
    mostrarToast("Error", "No se pudo eliminar el alumno.", "error");
  }
}

function imprimirTodosLosCarnets() {
  document.body.classList.remove("print-single-carnet", "print-reporte");
  document.body.classList.add("print-all-carnets");
  window.print();
  setTimeout(() => document.body.classList.remove("print-all-carnets"), 500);
}

function imprimirCarnetIndividual(codigo) {
  document.querySelectorAll(".carnet-card").forEach((c) => c.classList.remove("print-target"));
  const target = document.getElementById(`carnet-${codigo}`);
  if (!target) return;

  target.classList.add("print-target");
  document.body.classList.remove("print-all-carnets", "print-reporte");
  document.body.classList.add("print-single-carnet");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("print-single-carnet");
    target.classList.remove("print-target");
  }, 500);
}

// ============================================================================
// PESTAÑA 3: HISTORIAL, AUSENTES, REPORTES Y ALERTAS WHATSAPP
// ============================================================================
function activarVistaAusentes() {
  const selectEstado = document.getElementById("filtroEstadoReporte");
  if (!selectEstado) return;
  if (selectEstado.value === "AUSENTES") {
    selectEstado.value = "TODOS";
  } else {
    selectEstado.value = "AUSENTES";
  }
  renderizarTablaReportes();
}

function obtenerDatosFiltradosReporte() {
  const busqueda = (document.getElementById("filtroBusquedaReporte")?.value || "").trim().toLowerCase();
  const fechaFiltro = document.getElementById("filtroFechaReporte")?.value || obtenerFechaHoyISO();
  const gradoFiltro = document.getElementById("filtroGradoReporte")?.value || "TODOS";
  const estadoFiltro = document.getElementById("filtroEstadoReporte")?.value || "TODOS";

  const btnAusentes = document.getElementById("btnToggleAusentes");
  if (btnAusentes) {
    if (estadoFiltro === "AUSENTES") {
      btnAusentes.classList.replace("btn-outline", "btn-primary");
      btnAusentes.innerHTML = `<i class="fa-solid fa-list-check"></i> Ver Asistencias Registradas`;
    } else {
      btnAusentes.classList.replace("btn-primary", "btn-outline");
      btnAusentes.innerHTML = `<i class="fa-solid fa-user-slash"></i> Ver Lista de Ausentes del Día`;
    }
  }

  // Caso Especial: Cruzar los 30 matriculados con los que asistieron en la fecha seleccionada
  if (estadoFiltro === "AUSENTES") {
    const asistenciasFecha = obtenerAsistenciasDeFecha(fechaFiltro);
    const codigosPresentes = new Set(asistenciasFecha.map((r) => r.codigo));
    const fechaLeg = formatearFechaISOaLegible(fechaFiltro);

    return listaAlumnosGlobal
      .filter((al) => !codigosPresentes.has(al.codigo))
      .filter((al) => {
        const pasaGrado = gradoFiltro === "TODOS" || al.grado === gradoFiltro;
        const pasaBusqueda =
          !busqueda ||
          al.nombre.toLowerCase().includes(busqueda) ||
          al.codigo.toLowerCase().includes(busqueda);
        return pasaGrado && pasaBusqueda;
      })
      .map((al) => ({
        id: null,
        codigo: al.codigo,
        nombre: al.nombre,
        grado: al.grado,
        telefono: al.telefono,
        fechaISO: fechaFiltro,
        fecha: fechaLeg,
        hora: "Sin registro",
        estado: "AUSENTE"
      }));
  }

  // Filtrado de asistencias registradas
  return listaAsistenciasGlobal.filter((reg) => {
    const pasaFecha = !fechaFiltro || reg.fechaISO === fechaFiltro;
    const pasaGrado = gradoFiltro === "TODOS" || reg.grado === gradoFiltro;
    const pasaEstado = estadoFiltro === "TODOS" || reg.estado === estadoFiltro;
    const pasaBusqueda =
      !busqueda ||
      reg.nombre.toLowerCase().includes(busqueda) ||
      reg.codigo.toLowerCase().includes(busqueda);
    return pasaFecha && pasaGrado && pasaEstado && pasaBusqueda;
  });
}

function renderizarTablaReportes() {
  const tbody = document.getElementById("tablaReportesBody");
  if (!tbody) return;

  const filas = obtenerDatosFiltradosReporte();

  if (filas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:28px; color:var(--text-secondary);">
          No se encontraron registros para los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filas.map((reg) => {
    const waUrl = construirUrlWhatsApp(reg.telefono, reg.nombre, reg.grado, reg.fecha, reg.hora, reg.estado);

    const botonesAccion = reg.id
      ? `
        <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm" title="Enviar Alerta WhatsApp al Padre">
          <i class="fa-brands fa-whatsapp"></i> WhatsApp
        </a>
        ${reg.estado !== "JUSTIFICADO" ? `
          <button class="btn btn-outline btn-sm" onclick="marcarComoJustificado('${reg.id}', '${reg.nombre.replace(/'/g, "\\'")}')" title="Cambiar a Justificado">
            <i class="fa-solid fa-file-medical"></i> Justificar
          </button>
        ` : ""}
        <button class="btn btn-danger btn-sm" onclick="eliminarRegistroAsistencia('${reg.id}')" title="Eliminar registro">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      `
      : `
        <a href="${waUrl}" target="_blank" class="btn btn-whatsapp btn-sm">
          <i class="fa-brands fa-whatsapp"></i> Consultar Inasistencia
        </a>
        <button class="btn btn-outline btn-sm" onclick="registrarJustificacionAusente('${reg.codigo}')">
          <i class="fa-solid fa-file-shield"></i> Justificar Falta
        </button>
      `;

    return `
      <tr>
        <td>
          <div class="student-cell">
            <div class="avatar-circle" style="background:${obtenerColorAvatar(reg.codigo)}">
              ${obtenerIniciales(reg.nombre)}
            </div>
            <div>
              <div style="font-weight:700;">${reg.nombre}</div>
              <div style="font-size:0.75rem; color:var(--text-secondary);">Tel: +${reg.telefono}</div>
            </div>
          </div>
        </td>
        <td><span class="code-pill">${reg.codigo}</span></td>
        <td>${reg.grado}</td>
        <td>${reg.fecha}</td>
        <td style="font-variant-numeric:tabular-nums; font-weight:600;">${reg.hora}</td>
        <td>${renderizarBadgeEstado(reg.estado)}</td>
        <td class="no-print">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${botonesAccion}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function marcarComoJustificado(docId, nombre) {
  try {
    await db.collection("asistencias").doc(docId).update({
      estado: "JUSTIFICADO"
    });
    mostrarToast("Estado Actualizado", `La asistencia de ${nombre} fue marcada como JUSTIFICADO.`, "info");
  } catch (err) {
    console.error("Error al justificar:", err);
    mostrarToast("Error", "No se pudo actualizar el estado.", "error");
  }
}

async function registrarJustificacionAusente(codigo) {
  const alumno = listaAlumnosGlobal.find((a) => a.codigo === codigo);
  if (!alumno) return;
  const fechaFiltro = document.getElementById("filtroFechaReporte")?.value || obtenerFechaHoyISO();

  try {
    await db.collection("asistencias").add({
      codigo: alumno.codigo,
      nombre: alumno.nombre,
      alumno: `${alumno.codigo} - ${alumno.nombre}`,
      grado: alumno.grado,
      telefono: alumno.telefono,
      fechaISO: fechaFiltro,
      fecha: formatearFechaISOaLegible(fechaFiltro),
      hora: obtenerHoraActualLegible(new Date()),
      estado: "JUSTIFICADO",
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    mostrarToast("Inasistencia Justificada", `Se registró permiso justificado para ${alumno.nombre}.`, "success");
  } catch (err) {
    console.error("Error registrando justificación:", err);
  }
}

async function eliminarRegistroAsistencia(docId) {
  if (!confirm("¿Eliminar este registro de asistencia de la nube?")) return;
  try {
    await db.collection("asistencias").doc(docId).delete();
    mostrarToast("Registro Eliminado", "El ingreso fue eliminado correctamente.", "warning");
  } catch (err) {
    console.error("Error al eliminar asistencia:", err);
    mostrarToast("Error", "No se pudo eliminar el registro.", "error");
  }
}

// Exportación en Excel (CSV con UTF-8 BOM para tildes perfectas)
function exportarReporteCSV() {
  const filas = obtenerDatosFiltradosReporte();
  if (filas.length === 0) {
    mostrarToast("Sin datos", "No hay registros en la vista actual para exportar.", "warning");
    return;
  }

  const encabezados = ["Código", "Alumno", "Grado", "Teléfono Apoderado", "Fecha", "Hora", "Estado"];
  const lineas = filas.map((r) => [
    `"${r.codigo}"`,
    `"${r.nombre.replace(/"/g, '""')}"`,
    `"${r.grado}"`,
    `"${r.telefono}"`,
    `"${r.fecha}"`,
    `"${r.hora}"`,
    `"${r.estado}"`
  ].join(";"));

  const contenidoCSV = "\uFEFF" + [encabezados.join(";"), ...lineas].join("\r\n");
  const blob = new Blob([contenidoCSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `Reporte_Asistencia_${obtenerFechaHoyISO()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  mostrarToast("Excel Generado", "El archivo CSV con soporte de tildes se descargó con éxito.", "success");
}

function imprimirReporteDiaPDF() {
  const headerPrint = document.getElementById("printReportHeader");
  if (headerPrint) headerPrint.style.display = "block";
  document.body.classList.remove("print-all-carnets", "print-single-carnet");
  document.body.classList.add("print-reporte");
  window.print();
  setTimeout(() => {
    document.body.classList.remove("print-reporte");
    if (headerPrint) headerPrint.style.display = "none";
  }, 500);
}

// ============================================================================
// PESTAÑA 4: CONFIGURACIÓN INSTITUCIONAL Y MANTENIMIENTO
// ============================================================================
async function guardarIdentidadColegio(event) {
  event.preventDefault();
  const nombre = document.getElementById("cfgNombreColegio").value.trim();
  const lema = document.getElementById("cfgLemaColegio").value.trim();
  if (!nombre) return;

  try {
    await guardarConfiguracionEnNube({ nombre, lema });
    mostrarToast("Configuración Sincronizada", "Nombre y lema actualizados en tiempo real.", "success");
  } catch (err) {
    console.error("Error guardando identidad:", err);
    mostrarToast("Error", "No se pudo guardar la configuración.", "error");
  }
}

function procesarSubidaLogo(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      // Redimensionar a un tamaño óptimo para Firestore y QRs (máx 220x220)
      const canvas = document.createElement("canvas");
      const maxDim = 220;
      let w = img.width;
      let h = img.height;
      if (w > h && w > maxDim) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else if (h > maxDim) {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const base64Optimizado = canvas.toDataURL("image/png", 0.9);

      try {
        await guardarConfiguracionEnNube({ logo: base64Optimizado });
        mostrarToast("Escudo Actualizado", "El nuevo logo ya se aplicó en los 30 carnets QR y en el móvil.", "success");
      } catch (err) {
        console.error("Error subiendo logo:", err);
        mostrarToast("Error", "No se pudo guardar el logo en la nube.", "error");
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function restaurarLogoVectorial() {
  try {
    await guardarConfiguracionEnNube({ logo: DEFAULT_LOGO_BASE64 });
    mostrarToast("Escudo Restaurado", "Se restableció el escudo vectorial institucional por defecto.", "info");
  } catch (err) {
    console.error("Error restaurando logo:", err);
  }
}

async function guardarReglasHorario(event) {
  event.preventDefault();
  const horaLimite = document.getElementById("cfgHoraLimite").value || "08:00";
  const tolerancia = Number(document.getElementById("cfgTolerancia").value || 0);

  try {
    await guardarConfiguracionEnNube({ horaLimite, tolerancia });
    mostrarToast("Horario Actualizado", `Hora límite: ${horaLimite} (+${tolerancia} min tolerancia).`, "success");
  } catch (err) {
    console.error("Error guardando horario:", err);
    mostrarToast("Error", "No se pudieron actualizar las reglas de horario.", "error");
  }
}

async function limpiarHistorialAsistencias() {
  if (!confirm("¿Estás seguro de eliminar TODOS los registros de asistencia de prueba en Firebase?")) return;
  try {
    const snap = await db.collection("asistencias").get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    mostrarToast("Historial Limpiado", "Se eliminaron todas las asistencias de prueba.", "warning");
  } catch (err) {
    console.error("Error limpiando historial:", err);
    mostrarToast("Error", "No se pudo limpiar la colección de asistencias.", "error");
  }
}

async function restaurarPadronSemilla() {
  if (!confirm("¿Restaurar y asegurar los 30 alumnos de Primaria (PRI-001 a PRI-030) en Firebase?")) return;
  try {
    await sembrarAlumnosIniciales();
    mostrarToast("Padrón Restaurado", "Los 30 alumnos de Primaria están sincronizados.", "success");
  } catch (err) {
    console.error("Error restaurando padrón:", err);
    mostrarToast("Error", "No se pudo restaurar el padrón inicial.", "error");
  }
}
