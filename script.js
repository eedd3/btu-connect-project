const socket = io();
let currentFlow = "", tempCoords = null, activePass = "";
let knownPosts = [];

// ─── 1. SECURITY & VPN HANDSHAKE ───
async function initSecurity() {
    socket.emit('validate-connection', {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language
    });
}
initSecurity();

socket.on('security-response', (res) => {
    const guard = document.getElementById('vpn-guard');
    if (res.allowed) {
        guard.style.display = 'none';
        document.body.classList.remove('system-locked');
    } else {
        document.body.classList.add('system-locked');
        guard.style.display = 'flex';
        document.getElementById('guard-msg').innerHTML = `<b>Reason:</b> ${res.reason}`;
    }
});

// ─── 2. GATEWAY & AUTH LOGIC (ADMIN FIX) ───
function openGate(role) {
    currentFlow = role;
    
    // Check for existing valid session
    const session = localStorage.getItem(`btu_session_${role}`);
    if (session) {
        const data = JSON.parse(session);
        if (Date.now() - data.ts < 43200000) { // 12 Hours Valid
            activePass = data.pass;
            if (role === 'ADMIN') {
                socket.emit('admin-fetch', activePass);
            } else if (role === 'TEACHER') {
                syncFields(); openModal();
            }
            return;
        }
    }

    // No session? Show PIN Box
    if (role === 'STUDENT') {
        syncFields(); openModal();
    } else {
        document.getElementById('gate-title').innerText = role === 'ADMIN' ? "Admin Lockdown" : "Staff Identity";
        document.getElementById('gate-pin').value = ""; // Clear previous
        show('gate-overlay');
    }
}

function submitGate() {
    activePass = document.getElementById('gate-pin').value;
    if (!activePass) return showToast("PIN Required");

    if (currentFlow === 'ADMIN') {
        socket.emit('admin-fetch', activePass);
    } else {
        // Teacher Verification
        localStorage.setItem(`btu_session_TEACHER`, JSON.stringify({ pass: activePass, ts: Date.now() }));
        hide('gate-overlay');
        syncFields(); openModal();
    }
}

// Admin Data Success Handler
socket.on('admin-data', (logs) => {
    hide('gate-overlay');
    localStorage.setItem(`btu_session_ADMIN`, JSON.stringify({ pass: activePass, ts: Date.now() }));
    
    // Switch UI to Admin View
    nav('ADMIN', document.querySelectorAll('.tab')[3]);
    
    const wall = document.getElementById('wall-admin');
    wall.innerHTML = `<h2 style="font-family:'Syne'; margin-bottom:1.5rem; color:var(--danger);">Security Audit Logs</h2>`;
    
    if (logs.length === 0) {
        wall.innerHTML += `<p style="color:var(--muted);">No logs available.</p>`;
    } else {
        logs.forEach(l => {
            const item = document.createElement('div');
            item.className = 'card';
            item.style.borderLeft = "4px solid var(--danger)";
            item.innerHTML = `
                <div class="card-meta">
                    <span style="color:var(--danger);">IP: ${l.ip}</span>
                    <span>${l.time}</span>
                </div>
                <div class="card-body">
                    <h3>${l.name} <small style="color:var(--muted);">(${l.role})</small></h3>
                    <p>${l.msg}</p>
                    <div style="margin-top:10px; font-size:10px; color:var(--muted);">
                        ISP/Provider: ${l.isp || 'N/A'} | GPS: ${l.coords ? l.coords.lat+','+l.coords.lng : 'No GPS'}
                    </div>
                </div>
            `;
            wall.appendChild(item);
        });
    }
});

socket.on('admin-err', () => {
    showToast("Invalid Access PIN");
    localStorage.removeItem('btu_session_ADMIN');
});

// ─── 3. BROADCAST ENGINE ───
function sendData() {
    const name = document.getElementById('f-name').value;
    const dept = document.getElementById('f-dept').value;
    const msg = document.getElementById('f-msg').value;
    const cat = document.getElementById('f-cat').value;

    if (!name || !dept || !msg) return showToast("Fields Empty!");

    localStorage.setItem(`btu_id_${currentFlow.toLowerCase()}`, JSON.stringify({ name, dept }));

    socket.emit('submit-broadcast', {
        id: 'post-' + Date.now(),
        role: currentFlow, pass: activePass, coords: tempCoords,
        name, dept, msg, cat
    });
}

socket.on('publish-confirmed', () => {
    showToast("✓ Broadcast Live");
    closeSheet({ target: { id: 'modal-overlay' } });
    document.getElementById('f-msg').value = "";
    nav('FEED', document.querySelector('.tab'));
});

socket.on('sync-feed', (posts) => {
    const wall = document.getElementById('wall-feed');
    wall.innerHTML = "";
    knownPosts = [];
    posts.forEach(p => { if(!knownPosts.includes(p.id)) { knownPosts.push(p.id); addCard(p); } });
});

socket.on('push-new', (post) => {
    if (knownPosts.includes(post.id)) return;
    knownPosts.push(post.id);
    addCard(post, true);
    if (document.getElementById('wall-feed').style.display === 'none') {
        document.getElementById('feed-dot').style.display = 'block';
    }
});

function addCard(p, isNew = false) {
    const wall = document.getElementById('wall-feed');
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="card-meta"><span>#${p.cat}</span><span>${p.time}</span></div>
        <div class="card-body"><h3>${p.name} <small>| ${p.dept}</small></h3><p>${p.msg}</p></div>
        <div class="role-badge">${p.role} VERIFIED</div>
    `;
    isNew ? wall.prepend(card) : wall.appendChild(card);
}

// ─── 4. NAVIGATION & MODALS ───
function nav(tab, btn) {
    if (tab === 'FEED') document.getElementById('feed-dot').style.display = 'none';
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    
    document.getElementById('wall-feed').style.display = tab === 'FEED' ? 'block' : 'none';
    document.getElementById('wall-admin').style.display = tab === 'ADMIN' ? 'block' : 'none';
}

function openModal() {
    show('modal-overlay');
    setTimeout(() => document.getElementById('post-sheet').classList.add('active'), 10);
    const pill = document.getElementById('geo-line');
    const btn = document.getElementById('f-btn');

    if (currentFlow === 'STUDENT') {
        pill.innerText = "📡 Scanning Campus Location...";
        btn.disabled = true;
        navigator.geolocation.getCurrentPosition(pos => {
            tempCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            socket.emit('geo-verify', tempCoords);
        }, () => { 
            pill.innerText = "❌ GPS ACCESS DENIED"; 
            pill.style.color = "var(--danger)";
        }, { enableHighAccuracy: true });
    } else {
        pill.innerText = "✅ STAFF CLEARANCE GRANTED";
        pill.style.color = "var(--success)";
        btn.disabled = false;
    }
}

socket.on('geo-status', (res) => {
    const pill = document.getElementById('geo-line');
    const btn = document.getElementById('f-btn');
    if (res.allowed) {
        pill.innerText = "VERIFIED...YOUR ARE INSIDE BTU CAMPUS";
        pill.style.color = "var(--success)";
        btn.disabled = false;
    } else {
        pill.innerText = "❌ OUTSIDE CAMPUS BOUNDARY";
        pill.style.color = "var(--danger)";
    }
});

// UI Helpers
function showToast(m) {
    const box = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast'; t.innerText = m; box.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}

function syncFields() {
    const saved = JSON.parse(localStorage.getItem(`btu_id_${currentFlow.toLowerCase()}`));
    if (saved) {
        document.getElementById('f-name').value = saved.name;
        document.getElementById('f-dept').value = saved.dept;
    }
}

function show(id) { document.getElementById(id).style.display = 'flex'; }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function hideGate() { hide('gate-overlay'); }
function closeSheet(e) {
    if (e.target.id === 'modal-overlay') {
        document.getElementById('post-sheet').classList.remove('active');
        setTimeout(() => hide('modal-overlay'), 400);
    }
}
