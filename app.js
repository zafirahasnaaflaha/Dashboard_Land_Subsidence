// =========================================================
// 1. HELPER: CONVERT DESIMAL DENGAN KOMA (DESIMAL INDONESIA)
// =========================================================
function parseInSARValue(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const cleaned = val.toString().replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

// Warna Marker berdasarkan Kecepatan (Velocity)
function getColor(velocity) {
    const v = parseInSARValue(velocity);
    return v > 10  ? '#b91c1c' :
           v > 5   ? '#ef4444' :
           v > 1   ? '#f97316' :
           v > 0   ? '#eab308' : '#22c55e';
}

// =========================================================
// 2. INISIALISASI PETA & BASEMAP
// =========================================================
const map = L.map('map').setView([0.7893, 113.9213], 5);

const basemaps = {
    'carto-light': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }),
    'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
    }),
    'osm': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    })
};

basemaps['carto-light'].addTo(map);

const basemapSelect = document.getElementById('basemap-select');
if (basemapSelect) {
    basemapSelect.addEventListener('change', (e) => {
        Object.values(basemaps).forEach(layer => map.removeLayer(layer));
        if (basemaps[e.target.value]) {
            basemaps[e.target.value].addTo(map);
        }
    });
}

// Variable Global Layer
let realGeoJSONData = null;
let geojsonLayer = null;

// =========================================================
// 3. INISIALISASI GRAFIK 1 (LINE CHART)
// =========================================================
const ctx1 = document.getElementById('timeSeriesChart')?.getContext('2d');
let timeSeriesChart = null;

if (ctx1) {
    timeSeriesChart = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: ['2016', '2018', '2020', '2022', '2024'],
            datasets: [{
                label: 'Deformasi (mm)',
                data: [0, 0, 0, 0, 0],
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 4,
                pointBackgroundColor: '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top' } },
            scales: {
                x: { title: { display: true, text: 'Tahun' } },
                y: { title: { display: true, text: 'Displacement (mm)' } }
            }
        }
    });
}

// =========================================================
// 4. INISIALISASI GRAFIK 2 (SCATTER PLOT)
// =========================================================
const ctx2 = document.getElementById('scatterChart')?.getContext('2d');
let scatterChart = null;

if (ctx2) {
    scatterChart = new Chart(ctx2, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'LOS displacement [cm]',
                data: [],
                backgroundColor: '#0891b2',
                borderColor: '#0e7490',
                pointRadius: 3.5,
                showLine: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Akuisisi Waktu (Index)' },
                    grid: { display: true, color: '#f3f4f6' }
                },
                y: {
                    title: { display: true, text: 'LOS displacement [cm]' },
                    grid: { display: true, color: '#e5e7eb' }
                }
            }
        }
    });
}

// =========================================================
// 5. UPDATE POP-UP DETAIL & KEDUA GRAFIK
// =========================================================
function updateDashboardSelection(props, latlng) {
    if (!props) return;

    // A. Ambil nilai atribut dari GeoJSON
    const pointId = props.point_id || '-';
    const kecamatan = props.kecamatan || '-';
    const velocityVal = parseInSARValue(props.velocity);
    
    const lat = latlng ? latlng.lat.toFixed(5) : '-';
    const lng = latlng ? latlng.lng.toFixed(5) : '-';

    // B. Isi Nilai ke Elemen HTML (Sesuai ID di index.html)
    const floatingCard = document.getElementById('floating-card');
    if (floatingCard) floatingCard.classList.remove('hidden');

    const elemPointId = document.getElementById('point-id');
    const elemKecamatan = document.getElementById('point-kecamatan');
    const elemVelocity = document.getElementById('point-velocity');
    const elemCoords = document.getElementById('point-coords');

    if (elemPointId) elemPointId.innerText = `Point: ${pointId}`;
    if (elemKecamatan) elemKecamatan.innerText = kecamatan;
    if (elemVelocity) elemVelocity.innerText = `${velocityVal} mm/tahun`;
    if (elemCoords) elemCoords.innerText = `${lat}, ${lng}`;

    // C. Ambil Kolom Time Series (d_2016 s.d. d_2024)
    const timeKeys = Object.keys(props).filter(k => k.startsWith('d_')).sort();

    // D. Update Grafik 1 (Line Chart)
    if (timeSeriesChart) {
        const lineLabels = timeKeys.map(k => k.replace('d_', ''));
        const lineValues = timeKeys.map(k => parseInSARValue(props[k]));

        timeSeriesChart.data.labels = lineLabels;
        timeSeriesChart.data.datasets[0].data = lineValues;
        timeSeriesChart.data.datasets[0].label = `Deformasi ${pointId} (mm)`;
        timeSeriesChart.update();
    }

    // E. Update Grafik 2 (Scatter Plot InSAR)
    if (scatterChart) {
        const scatterPoints = timeKeys.map((key, index) => ({
            x: index + 1,
            y: parseInSARValue(props[key])
        }));

        scatterChart.data.datasets[0].data = scatterPoints;
        scatterChart.update();
    }
}

// =========================================================
// 6. RENDER DATA PETA & FILTER KECAMATAN
// =========================================================
function renderDashboardData(geojsonData) {
    const features = geojsonData.features || [];

    // Update KPI Widget
    const totalPointsElem = document.getElementById('total-points');
    const avgVelocityElem = document.getElementById('avg-velocity');

    if (totalPointsElem) totalPointsElem.innerText = features.length;
    if (avgVelocityElem && features.length > 0) {
        const avgVel = features.reduce((acc, cur) => acc + parseInSARValue(cur.properties.velocity), 0) / features.length;
        avgVelocityElem.innerText = `${avgVel.toFixed(1)} mm/thn`;
    }

    if (geojsonLayer) map.removeLayer(geojsonLayer);

    // Buat Marker Peta
    geojsonLayer = L.geoJSON(geojsonData, {
        pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng, {
                radius: 6,
                fillColor: getColor(feature.properties.velocity),
                color: "#ffffff",
                weight: 1,
                fillOpacity: 0.85
            });
        },
        onEachFeature: function (feature, layer) {
            layer.on('click', function (e) {
                map.flyTo(e.latlng, 15, { animate: true, duration: 1 });
                updateDashboardSelection(feature.properties, e.latlng);
            });
        }
    }).addTo(map);

    // Auto-zoom ke cakupan area titik InSAR
    if (geojsonLayer && geojsonLayer.getBounds().isValid()) {
        map.fitBounds(geojsonLayer.getBounds(), { padding: [50, 50] });
    }
}

// =========================================================
// 7. MEMUAT FILE GEOJSON
// =========================================================
fetch('data/subsidence_kulonprogo.geojson')
    .then(response => {
        if (!response.ok) throw new Error("Gagal membaca file GeoJSON");
        return response.json();
    })
    .then(data => {
        realGeoJSONData = data;
        renderDashboardData(realGeoJSONData);

        // Otomatis tampilkan info titik pertama
        if (realGeoJSONData.features && realGeoJSONData.features.length > 0) {
            const firstFeature = realGeoJSONData.features[0];
            const coords = firstFeature.geometry.coordinates;
            const latlng = L.latLng(coords[1], coords[0]);
            updateDashboardSelection(firstFeature.properties, latlng);
        }
    })
    .catch(err => {
        console.error("❌ Error Data InSAR:", err.message);
    });

// =========================================================
// 8. KONTROL INTERAKSI (TUTUP POP-UP & CONTROL PANEL)
// =========================================================
const closeCardBtn = document.getElementById('close-card');
if (closeCardBtn) {
    closeCardBtn.addEventListener('click', () => {
        document.getElementById('floating-card')?.classList.add('hidden');
        if (geojsonLayer && geojsonLayer.getBounds().isValid()) {
            map.fitBounds(geojsonLayer.getBounds(), { padding: [50, 50] });
        }
    });
}

// Control Panel Toggle (Minimize/Maximize)
const toggleControlBtn = document.getElementById('toggle-control-btn');
const controlBody = document.getElementById('control-body');
if (toggleControlBtn && controlBody) {
    toggleControlBtn.addEventListener('click', () => {
        if (controlBody.style.display === 'none') {
            controlBody.style.display = 'block';
            toggleControlBtn.innerHTML = '&minus;';
        } else {
            controlBody.style.display = 'none';
            toggleControlBtn.innerHTML = '&#43;';
        }
    });
}