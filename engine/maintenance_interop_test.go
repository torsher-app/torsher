//go:build linux || darwin

package main

import (
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Проверяет именно Node stat -> JSON -> Go identity, а не две отдельные fixtures.
// TORSHER_TEST_NODE указывает на закреплённый runtime pnpm; без него Go-only CI
// выполняет остальные maintenance tests без зависимости от установленного Node.
func TestMaintenanceNodeInterop(t *testing.T) {
	node := os.Getenv("TORSHER_TEST_NODE")
	if node == "" {
		t.Skip("set TORSHER_TEST_NODE to the pinned Node executable")
	}
	a, _ := newTestEngine(t, t.TempDir())
	a.maintenanceToken = strings.Repeat("i", 64)
	item := maintenanceFixture(t)
	server := httptest.NewServer(a.routes())
	defer func() { server.Close() }()
	script := filepath.Join(t.TempDir(), "interop.mjs")
	code := `
import {stat, realpath, writeFile, readFile, link} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [url, token, root, path, phase, snapshot] = process.argv.slice(2);
async function call(method, suffix, data) {
 const response = await fetch(url + '/maintenance' + suffix, {method,headers:{'Content-Type':'application/json','X-Torsher-Maintenance-Token':token},body:data === undefined ? undefined : JSON.stringify(data)});
 const result = await response.json(); assert.equal(response.status,200,JSON.stringify(result)); return result;
}
if(phase === 'prepare') {
 const base=await stat(root), file=await stat(path);
 assert(Number.isSafeInteger(base.ino) && Number.isSafeInteger(file.ino));
 const manifest={infoHash:'e'.repeat(40),pieceCount:2,paths:[{root:await realpath(root),path:await realpath(path),rootDevice:String(base.dev),rootInode:base.ino,device:String(file.dev),inode:file.ino,size:file.size,mtime:file.mtimeMs}]};
 await link(path,path+'.external');
 await writeFile(snapshot,JSON.stringify(manifest));
 const reply=await call('POST','/node-interop/prepare',manifest); assert.equal(reply.state,'detached'); assert.deepEqual(reply.manifest,manifest);
 assert.equal((await call('GET','')).length,1);
} else {
 const manifest=JSON.parse(await readFile(snapshot,'utf8'));
 const pending=await call('GET','/node-interop'); assert.equal(pending.state,'detached'); assert.deepEqual(pending.manifest,manifest);
 assert.equal((await call('POST','/node-interop/prepare',manifest)).state,'detached');
 const deleted=await call('POST','/node-interop/unlink',{index:0}); assert.equal(deleted.results['0'],'removed');
 assert.equal((await call('POST','/node-interop/finalize')).state,'finalized');
 assert.equal(await readFile(path+'.external','utf8'),'synthetic');
 await assert.rejects(stat(path),{code:'ENOENT'});
}
`
	if err := os.WriteFile(script, []byte(code), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot.json")
	for _, phase := range []string{"prepare", "recover"} {
		if phase == "recover" {
			server.Close()
			a = newAPI(a.client, a.session, clientParts{lifecycle: a.lifecycle, downloads: a.downloads, completion: a.completion, limits: a.limits, windows: a.windows}, a.logger)
			a.maintenanceToken = strings.Repeat("i", 64)
			server = httptest.NewServer(a.routes())
			if a.maintenance.loadErr != nil {
				t.Fatal(a.maintenance.loadErr)
			}
		}
		cmd := exec.Command(node, script, server.URL, a.maintenanceToken, item.Root, item.Path, phase, snapshot)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", phase, err, output)
		}
	}
}

func TestMaintenanceInventoryRequiresCapability(t *testing.T) {
	a, _ := newTestEngine(t, t.TempDir())
	item := maintenanceFixture(t)
	manifest := detachManifest{InfoHash: strings.Repeat("f", 40), PieceCount: 1, Paths: []maintenancePath{item}}
	if response := maintenanceRequest(t, a, "POST", "/maintenance/unknown-to-restored-db/prepare", manifest); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	a = newAPI(a.client, a.session, clientParts{lifecycle: a.lifecycle, downloads: a.downloads, completion: a.completion, limits: a.limits, windows: a.windows}, a.logger)
	unauthorized := httptest.NewRecorder()
	a.routes().ServeHTTP(unauthorized, httptest.NewRequest("GET", "/maintenance", nil))
	if unauthorized.Code != 403 {
		t.Fatal("inventory exposed without capability", unauthorized.Code)
	}
	response := maintenanceRequest(t, a, "GET", "/maintenance", nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "unknown-to-restored-db") {
		t.Fatal(response.Code, response.Body.String())
	}
}
