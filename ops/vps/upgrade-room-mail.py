"""One exact mail-only upgrade. Local preparation; execution requires approval."""
import contextlib
import fcntl
import hashlib
import io
import json
import os
import pwd
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import metadata

OLD_REV='dc8355093f42cb00501d9f587e494b25811af884'
OLD_IMAGE='sha256:667781d8921b05766d04090a3dd4a34bc62ae3b6ae3cd2202a8b5e9747753300'
OLD_SOURCE='fea4874c1877a4c227302c8030da6d4f6b2855450de27a7362f021d854e40c5b'
NEW_SOURCE='37ed2a28acda640f73af4e2db90b5cb9f41b434a016a5b85c978ae579d413fc3'
NAME='becore-tickets-mail'
ROOT=Path('/etc/becore-tickets-mail')
FLAG=ROOT/'control/sending-enabled'
DB=Path('/var/lib/becore-tickets-mail/outbox.sqlite')
MAIL_UID=10000
STAGE='preconditions'
FAILED_STAGE=None
READ_STEP=None
# Values are compared inside Docker's template: unexpected env strings/labels
# are never emitted or passed to the operator. No credentials are inspected.
ENV_TEMPLATE='{{range .Config.Env}}{{if eq . "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}}path;{{else if eq . "DEBIAN_FRONTEND=noninteractive"}}frontend;{{else if eq . "RELEASE_SHA=REVISION"}}release;{{else}}unexpected;{{end}}{{end}}'
FIELDS={
 'image':'.Image','running':'.State.Running','id':'.Id',
 'entrypoint':'.Config.Entrypoint','cmd':'.Config.Cmd','user':'.Config.User','workdir':'.Config.WorkingDir',
 'privileged':'.HostConfig.Privileged','readonly_root':'.HostConfig.ReadonlyRootfs',
 'network':'.HostConfig.NetworkMode','ports':'.HostConfig.PortBindings','tmpfs':'.HostConfig.Tmpfs',
 'memory':'.HostConfig.Memory','memory_swap':'.HostConfig.MemorySwap','nano_cpus':'.HostConfig.NanoCpus',
 'pids':'.HostConfig.PidsLimit','restart':'.HostConfig.RestartPolicy','security':'.HostConfig.SecurityOpt',
 'cap_add':'.HostConfig.CapAdd','cap_drop':'.HostConfig.CapDrop','devices':'.HostConfig.Devices',
 'device_requests':'.HostConfig.DeviceRequests','extra_hosts':'.HostConfig.ExtraHosts',
 'pid_mode':'.HostConfig.PidMode','ipc_mode':'.HostConfig.IpcMode','userns':'.HostConfig.UsernsMode',
 'volumes_from':'.HostConfig.VolumesFrom','links':'.HostConfig.Links','dns':'.HostConfig.Dns',
 'binds':'.HostConfig.Binds','init':'.HostConfig.Init','auto_remove':'.HostConfig.AutoRemove',
 'runtime':'.HostConfig.Runtime','cgroup_parent':'.HostConfig.CgroupParent',
 'sysctls':'.HostConfig.Sysctls','groups':'.HostConfig.GroupAdd','oom_disable':'.HostConfig.OomKillDisable',
 'publish_all':'.HostConfig.PublishAllPorts','tty':'.Config.Tty','open_stdin':'.Config.OpenStdin',
 'domainname':'.Config.Domainname','hostname':'.Config.Hostname',
 'log_config':'.HostConfig.LogConfig','ulimits':'.HostConfig.Ulimits','cpuset':'.HostConfig.CpusetCpus',
 'cpu_shares':'.HostConfig.CpuShares','cpu_quota':'.HostConfig.CpuQuota','cgroupns':'.HostConfig.CgroupnsMode',
 'readonly_paths':'.HostConfig.ReadonlyPaths','masked_paths':'.HostConfig.MaskedPaths',
 'mounts':'.Mounts'}
EXPECTED={
 'entrypoint':['/usr/bin/tini','--','/app/start.sh'],'cmd':None,'user':'','workdir':'',
 'privileged':False,'readonly_root':False,'network':'bridge',
 'ports':{'8826/tcp':[{'HostIp':'127.0.0.1','HostPort':'8826'}]},
 'tmpfs':{'/run':'rw,nosuid,nodev,size=16m'},'memory':536870912,'memory_swap':1073741824,
 'nano_cpus':1000000000,'pids':128,'restart':{'Name':'unless-stopped','MaximumRetryCount':0},
 'security':['no-new-privileges:true'],'cap_add':None,'cap_drop':None,'devices':[],
 'device_requests':None,'extra_hosts':None,'pid_mode':'','ipc_mode':'private','userns':'',
 'volumes_from':None,'links':None,'dns':[],'binds':None,'init':None,'auto_remove':False,
 'runtime':'runc','cgroup_parent':'','sysctls':None,'groups':None,'oom_disable':None,
 'publish_all':False,'tty':False,'open_stdin':False,'domainname':'',
 'log_config':{'Type':'json-file','Config':{}},'ulimits':[],'cpuset':'','cpu_shares':0,'cpu_quota':0,'cgroupns':'private',
 'readonly_paths':['/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger'],
 'masked_paths':['/proc/asound','/proc/acpi','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/timer_list','/proc/timer_stats','/proc/sched_debug','/proc/scsi','/sys/firmware','/sys/devices/virtual/powercap']}
MOUNTS={
 '/secrets':('bind',str(ROOT),False),'/control':('bind',str(ROOT/'control'),False),
 '/data':('bind','/var/lib/becore-tickets-mail',True),'/mail-log':('bind','/var/log/becore-tickets-mail',True),
 '/var/spool/postfix':('volume','becore-tickets-mail-spool',True)}


CHECKS={'config_'+key for key in EXPECTED}|{'config_identity','config_network_identity','config_env','config_mounts',
        'service_health','source_hash','schema_codes','file_ownership','app_config_shape','app_config_effective',
        'root_directory','control_directory','db_directory','sending_marker','rollback_name','failed_name',
        'operation_in_progress','private_ancestry'}
class CheckFailed(ValueError):
    def __init__(self,check):
        if check not in CHECKS:raise ValueError('Unknown safe check')
        self.check=check


def failure_report(error,read_only):
    metadata.STAGE=STAGE
    result=metadata.safe_failure(error)
    result.update(read_only=read_only,mode='preflight' if read_only else 'mail_upgrade',
                  uncertain_outcome=STAGE=='manual_reconciliation_required')
    if isinstance(error,CheckFailed):result['check']=error.check
    if isinstance(error,RouteBlocked):result.update(category='route_activation_blocked',provider=error.provider,signing_key_valid=error.key_valid)
    if FAILED_STAGE is not None:result['failed_stage']=FAILED_STAGE
    if READ_STEP is not None:result['read_step']=READ_STEP
    if isinstance(error,subprocess.CalledProcessError):
        raw=error.stderr if isinstance(error.stderr,bytes) else b''
        # Classify locally; never return stderr, arguments, or template values.
        categories=[(b'error calling len','template_length'),(b"can't evaluate field",'template_field'),
                    (b'map has no entry for key','template_missing_key'),(b'function "','template_function'),
                    (b'template parsing error','template_parse'),(b'No such container','container_missing'),
                    (b'No such image','image_missing'),(b'permission denied','permission_denied')]
        for marker,category in categories:
            if marker in raw[:8192]:result['command_category']=category;break
        else:result['command_category']='unclassified'
        # Return only a symbolic field from our own projection inventory, never
        # an arbitrary Docker error fragment or its associated value.
        projected={**FIELDS,'labels':'.Config.Labels','environment':'.Config.Env','networks':'.NetworkSettings.Networks'}
        for key,path in projected.items():
            leaf=path.rsplit('.',1)[-1].encode()
            if ('<'+path+'>').encode() in raw[:8192] or b'field '+leaf+b' in type ' in raw[:8192] or b'key "'+leaf+b'"' in raw[:8192]:
                result['projection_field']=key;break
    config_diagnostic=getattr(error,'config_diagnostic',None)
    if config_diagnostic is not None:result['config_diagnostic']=config_diagnostic
    diagnostic=getattr(error,'projection_diagnostic',None)
    if diagnostic is not None:result['projection_diagnostic']=diagnostic
    return result


@contextlib.contextmanager
def mail_identity():
    # Only synchronous SQLite work runs in this scope. Docker/control operations
    # run after restoring root. Missing WAL/SHM files are created as the mail UID.
    uid,gid,groups=os.geteuid(),os.getegid(),os.getgroups()
    if uid==MAIL_UID:
        yield
        return
    if uid!=0:raise PermissionError('Cannot assume existing mail identity')
    try:
        os.setgroups([]);os.setegid(MAIL_UID);os.seteuid(MAIL_UID)
        yield
    finally:
        os.seteuid(uid);os.setegid(gid);os.setgroups(groups)


def private_ancestry(path,uid):
    for directory in path.parents:
        info=directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0,uid) or info.st_mode&0o022:
            raise CheckFailed('private_ancestry')


def read_private(path,uid):
    private_ancestry(path,uid)
    before=safe_stat(path,uid,0o600)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if (info.st_dev,info.st_ino,info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode),info.st_size)!=before or info.st_size>131072:raise ValueError('Private config changed')
        raw=os.read(fd,131073)
        after=os.fstat(fd)
        if len(raw)!=info.st_size or (info.st_mtime_ns,info.st_ctime_ns)!=(after.st_mtime_ns,after.st_ctime_ns) or safe_stat(path,uid,0o600)!=before:raise ValueError('Private config changed')
        return raw
    finally:os.close(fd)


def command(args,data=None,timeout=20,limit=1048576):
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,check=True)
    if len(result.stdout)>limit:raise ValueError('Output bound')
    return result.stdout


def read_step(value):
    global READ_STEP
    READ_STEP=value


def image_check():
    read_step('image_config')
    template='{"id":{{json .Id}},"env":"'+ENV_TEMPLATE.replace('REVISION',OLD_REV)+'"}'
    data=json.loads(command(['docker','image','inspect','--format',template,OLD_IMAGE]))
    if data.get('id')!=OLD_IMAGE or sorted(data.get('env','').split(';'))!=['','frontend','path']:
        raise CheckFailed('config_env')


def projection_failures(name,revision):
    # Diagnose all fixed projections in one bounded read, with no values retained
    # or returned. An unsupported security field remains a hard failure.
    probes={key:'{{json '+path+'}}' for key,path in FIELDS.items()}
    probes.update(environment=ENV_TEMPLATE.replace('REVISION',revision),
                  labels='{{if .Config.Labels}}{{len .Config.Labels}}{{else}}0{{end}}',
                  networks='{{range $name, $value := .NetworkSettings.Networks}}{{$name}};{{end}}')
    deadline=time.monotonic()+15;failed=[];completed=0
    for key,template in probes.items():
        remaining=deadline-time.monotonic()
        if remaining<=0:break
        try:command(['docker','inspect','--type=container','--format',template,name],timeout=min(2,remaining),limit=65536)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired,ValueError):failed.append(key)
        completed+=1
    return {'failed_fields':failed,'completed':completed,'expected':len(probes),'incomplete':completed!=len(probes)}


def safe_config_observation(key,value):
    if value is None or type(value) is bool:return value
    if type(value) is int and -1<=value<=2**63-1:return value
    enums={'network':{'default','bridge','host','none'},'cgroupns':{'private','host'},
           'ipc_mode':{'private','host','shareable','none'},'pid_mode':{'','host'},
           'runtime':{'runc'},'userns':{'','host'}}
    if isinstance(value,str) and value in enums.get(key,set()):return value
    if isinstance(value,(list,dict)):return {'type':'list' if isinstance(value,list) else 'object','count':min(len(value),10000)}
    return {'type':'other'}


def inspect_config(name,revision,image,running=True):
    read_step('container_config')
    # These Docker API pointer/map fields are explicitly omitempty. Preserve
    # omitted as null, never a guessed boolean or security default.
    optional={'init':'(index .HostConfig \"Init\")','sysctls':'(index .HostConfig \"Sysctls\")'}
    template='{'+','.join(json.dumps(k)+':{{json '+optional.get(k,v)+'}}' for k,v in FIELDS.items())
    template+=',"env":"'+ENV_TEMPLATE.replace('REVISION',revision)+'","labels":{{if .Config.Labels}}{{len .Config.Labels}}{{else}}0{{end}},"networks":"{{range $name, $value := .NetworkSettings.Networks}}{{$name}};{{end}}"}'
    try:item=json.loads(command(['docker','inspect','--type=container','--format',template,name]))
    except subprocess.CalledProcessError as error:
        error.projection_diagnostic=projection_failures(name,revision)
        raise
    mismatches=[]
    if item['image']!=image or item['running'] is not running or not re.fullmatch('[a-f0-9]{64}',item['id']):mismatches.append('config_identity')
    network_identity=item['hostname']==item['id'][:12] and item['networks']=='bridge;'
    if not network_identity:mismatches.append('config_network_identity')
    observations={}
    for key,value in EXPECTED.items():
        if item[key]!=value:
            mismatches.append('config_'+key);observations[key]=safe_config_observation(key,item[key])
    if sorted(item['env'].split(';'))!=['','frontend','path','release'] or item['labels']!=0:mismatches.append('config_env')
    mounts=item['mounts'];mounts_match=len(mounts)==len(MOUNTS)
    for mount in mounts:
        actual=(mount.get('Type'),mount.get('Name') if mount.get('Type')=='volume' else mount.get('Source'),mount.get('RW'))
        if MOUNTS.get(mount.get('Destination'))!=actual or mount.get('Propagation','') not in ('','rprivate'):mounts_match=False
    if not mounts_match:mismatches.append('config_mounts')
    if mismatches:
        error=CheckFailed(mismatches[0])
        error.config_diagnostic={'mismatches':mismatches,'observations':observations,
                                 'bridge_network_identity_match':network_identity,'exact_mounts_match':mounts_match}
        raise error
    return item['id']


def app_check():
    read_step('application_identity')
    props=dict(line.split('=',1) for line in metadata.command(['systemctl','show','becore-tickets.service','--property=ActiveState,WorkingDirectory'],4096).splitlines())
    if props!={'ActiveState':'active','WorkingDirectory':'/srv/becore-tickets/releases/'+metadata.EXPECTED_APP}:raise ValueError('Application changed')


class RouteBlocked(Exception):
    def __init__(self,provider,key_valid):
        self.provider,self.key_valid=provider,key_valid


def provider_check():
    # Existing canonical/effective configuration only. Return enum/boolean;
    # neither key values nor configuration bytes leave this private check.
    read_step('application_pid')
    pid=metadata.command(['systemctl','show','becore-tickets.service','--property=MainPID','--value'],64).strip()
    if not re.fullmatch('[1-9][0-9]{0,9}',pid):raise ValueError('Service PID invalid')
    read_step('application_config_pointer')
    raw=(Path('/proc')/pid/'environ').read_bytes()
    if len(raw)>131072:raise ValueError('Effective environment bound')
    selected=[item for item in raw.split(b'\0') if item.startswith(b'TICKETS_CONFIG=')]
    if selected!=[b'TICKETS_CONFIG=/run/becore-tickets-runtime/runtime.json']:raise ValueError('Effective config path differs')
    read_step('application_private_configs')
    values=[read_private(Path('/etc/becore-tickets/runtime.json'),0),
            read_private(Path('/run/becore-tickets-runtime/runtime.json'),pwd.getpwnam('becore-tickets').pw_uid)]
    if values[0]!=values[1]:raise CheckFailed('app_config_effective')
    read_step('application_pid_recheck')
    if metadata.command(['systemctl','show','becore-tickets.service','--property=MainPID','--value'],64).strip()!=pid:raise ValueError('Service changed')
    def unique_object(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate configuration key')
            result[key]=value
        return result
    read_step('application_provider')
    config=json.loads(values[0],object_pairs_hook=unique_object)
    if not isinstance(config,dict) or not all(isinstance(v,str) for v in config.values()):raise CheckFailed('app_config_shape')
    provider=config.get('TRANSACTIONAL_EMAIL_PROVIDER')
    provider=provider if provider in ('vps','resend') else 'unknown'
    key=config.get('VPS_EMAIL_SIGNING_KEY')
    key_valid=isinstance(key,str) and len(key)>=32
    if provider!='vps' or not key_valid:raise RouteBlocked(provider,key_valid)
    return {'provider':'vps','signing_key_valid':True}


def wait_ready(revision,source,enabled):
    deadline=time.monotonic()+60
    expected={'service':NAME,'revision':revision,'sendingEnabled':enabled}
    while True:
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('Mail readiness deadline')
        try:
            health=metadata.health(timeout=min(5,remaining))
        except urllib.error.HTTPError as error:
            if error.code not in (502,503,504):raise
        except (urllib.error.URLError,ConnectionError,TimeoutError):
            pass
        else:
            if health!=expected:raise CheckFailed('service_health')
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('Mail readiness deadline')
            # Once health is available, a source/kind mismatch is never retried.
            raw=command(['docker','exec',NAME,'python3','-B','-c',metadata.SOURCE_READ],
                        timeout=min(15,remaining),limit=262144).decode()
            evidence=metadata.source_evidence(raw)
            if evidence['source_sha256']!=source:raise CheckFailed('source_hash')
            if source==NEW_SOURCE and (not evidence['room_host_post_supported'] or evidence['event_host_pass_supported']):raise CheckFailed('source_hash')
            if time.monotonic()>deadline:raise TimeoutError('Mail readiness deadline')
            return
        time.sleep(min(0.5,max(0,deadline-time.monotonic())))


def check_source_health(revision,source,enabled):
    read_step('container_source')
    evidence=metadata.source_evidence(metadata.command(['docker','exec',NAME,'python3','-B','-c',metadata.SOURCE_READ]))
    read_step('container_health')
    health=metadata.health()
    if evidence['source_sha256']!=source:raise CheckFailed('source_hash')
    if health!={'service':NAME,'revision':revision,'sendingEnabled':enabled}:raise CheckFailed('service_health')
    if source==NEW_SOURCE and (not evidence['room_host_post_supported'] or evidence['event_host_pass_supported']):raise ValueError('Kind mismatch')


def safe_stat(path,uid,mode=None):
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=uid or info.st_mode&0o022 or (mode is not None and stat.S_IMODE(info.st_mode)!=mode):raise CheckFailed('file_ownership')
    return (info.st_dev,info.st_ino,info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode),info.st_size)


def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def write_atomic(path,value):
    tmp=path.with_name(path.name+'.pending')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        if os.write(fd,value)!=len(value):raise ValueError('Short journal write')
        os.fsync(fd)
    finally:os.close(fd)
    os.replace(tmp,path);sync_dir(path.parent)


class Upgrade:
    def __init__(self,revision,source):
        if not re.fullmatch('[a-f0-9]{40}',revision) or revision==OLD_REV or hashlib.sha256(source).hexdigest()!=NEW_SOURCE:raise ValueError('Unreviewed input')
        self.revision,self.source=revision,source
        self.backup=NAME+'-rollback-'+revision[:12]
        self.paused=FLAG.with_name('sending-enabled.pause-'+revision[:12])
        self.journal=ROOT/('upgrade-'+revision+'.json')
        self.marker_identity=None;self.stop_attempted=False;self.stop_confirmed=False;self.start_uncertain=False;self.old_stopped=False;self.renamed=False;self.replacement=False;self.image=None

    def record(self,phase):
        write_atomic(self.journal,json.dumps({'phase':phase,'revision':self.revision,'source':NEW_SOURCE,'rollback_container':self.backup},sort_keys=True).encode())

    def build(self):
        archive=io.BytesIO()
        dockerfile=('FROM '+OLD_IMAGE+'\nCOPY --chown=0:0 mailer.py /app/mailer.py\n').encode()
        with tarfile.open(fileobj=archive,mode='w') as tar:
            for name,data in [('Dockerfile',dockerfile),('mailer.py',self.source)]:
                entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o644;entry.uid=entry.gid=0;entry.mtime=0;tar.addfile(entry,io.BytesIO(data))
        output=command(['docker','build','--quiet','--pull=false','--network=none','--tag',NAME+':'+self.revision,'-'],archive.getvalue(),timeout=120).decode().strip()
        if not re.fullmatch('sha256:[a-f0-9]{64}',output):raise ValueError('Image build receipt invalid')
        self.image=output

    @contextlib.contextmanager
    def fence(self,container):
        safe_stat(DB,MAIL_UID)
        for suffix in ('-wal','-shm'):
            side=Path(str(DB)+suffix)
            if side.exists() or side.is_symlink():safe_stat(side,MAIL_UID)
        db=None
        try:
            with mail_identity():
                db=sqlite3.connect(DB.as_uri()+'?mode=rw',uri=True,timeout=5)
                deadline=time.monotonic()+10
                db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
                db.execute('BEGIN IMMEDIATE')
                if db.execute("SELECT count(*) FROM messages WHERE status IN ('submitting','accepted','delayed','review')").fetchone()[0]:raise ValueError('Unsettled handoff')
            # Root is restored only for Docker. The transaction remains held.
            if command(['docker','exec',container,'postqueue','-j'],timeout=10).strip():raise ValueError('Postfix queue is not empty')
            yield db
            if db.total_changes:raise ValueError('Fence mutated data')
        finally:
            if db is not None:
                with mail_identity():db.rollback();db.close()

    def pause(self):
        if self.paused.exists():
            if FLAG.exists() or safe_stat(self.paused,0)!=self.marker_identity:raise ValueError('Pause marker changed')
            return
        if safe_stat(FLAG,0)!=self.marker_identity:raise ValueError('Sending marker changed')
        self.record('pause_boundary')
        os.rename(FLAG,self.paused);sync_dir(FLAG.parent)

    def enable(self,revision):
        if FLAG.exists() or safe_stat(self.paused,0)!=self.marker_identity:raise ValueError('Paused marker changed')
        write_atomic(ROOT/'revision',revision.encode())
        self.record('enable_boundary')  # durable before any new handoff is allowed
        os.rename(self.paused,FLAG);sync_dir(FLAG.parent)
        self.record('enabled')

    def start(self):
        args=['docker','run','-d','--name',NAME,'--restart','unless-stopped','--memory','512m','--cpus','1','--pids-limit','128','--security-opt','no-new-privileges:true','--publish','127.0.0.1:8826:8826','--env','RELEASE_SHA='+self.revision]
        for dest,(kind,src,rw) in MOUNTS.items():args+=['--mount','type='+kind+',src='+src+',dst='+dest+('' if rw else ',readonly')]
        args+=['--tmpfs','/run:rw,nosuid,nodev,size=16m',self.image]
        self.replacement=True;self.start_uncertain=True  # never repeat an uncertain run
        receipt=command(args).decode().strip()
        if not re.fullmatch('[a-f0-9]{64}',receipt):raise ValueError('Start outcome uncertain')
        self.start_uncertain=False

    def verify_schema(self):
        read_step('database_metadata')
        safe_stat(DB,10000)
        read_step('database_identity')
        identity=mail_identity();identity.__enter__()
        db=None
        try:
            read_step('database_readonly_count')
            db=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=5)
            db.execute('PRAGMA query_only=ON')
            cols={r[1]:r for r in db.execute('PRAGMA table_info(messages)')}
            for name in ('dsn_code','smtp_code'):
                if name not in cols or cols[name][2]!='TEXT' or cols[name][3]!=0 or cols[name][4] is not None:raise CheckFailed('schema_codes')
            if db.total_changes:raise ValueError('Verification mutated data')
        finally:
            if db is not None:db.close()
            identity.__exit__(None,None,None)

    def rollback(self):
        # Always requires a LIVE current process to prove queue emptiness. An
        # exited/unknown replacement is manual reconciliation, never a blind stop.
        if (self.stop_attempted and not self.stop_confirmed) or self.start_uncertain:
            raise ValueError('Container action outcome uncertain')
        if not self.old_stopped:
            # A stop timeout may have stopped the old process. Never infer it is
            # running or enable a stopped/unknown service after an uncertain call.
            inspect_config(NAME,OLD_REV,OLD_IMAGE,running=True)
            if self.paused.exists():self.enable(OLD_REV)
            self.record('aborted_original_running');return
        inspect_config(NAME,self.revision,self.image,running=True)
        with self.fence(NAME):
            self.pause()
            self.record('rollback_stop_boundary')
            command(['docker','stop','--time','30',NAME],timeout=40)
            inspect_config(NAME,self.revision,self.image,running=False)
            command(['docker','rename',NAME,NAME+'-failed-'+self.revision[:12]])
        command(['docker','rename',self.backup,NAME])
        command(['docker','start',NAME])
        inspect_config(NAME,OLD_REV,OLD_IMAGE)
        wait_ready(OLD_REV,OLD_SOURCE,False)
        self.enable(OLD_REV)
        check_source_health(OLD_REV,OLD_SOURCE,True)
        self.record('rolled_back')

    def check_paths(self):
        read_step('private_paths')
        for path,uid,check in [(ROOT,0,'root_directory'),(ROOT/'control',0,'control_directory'),(DB.parent,MAIL_UID,'db_directory')]:
            private_ancestry(path,uid)
            try:info=path.lstat()
            except OSError:raise CheckFailed(check) from None
            if not stat.S_ISDIR(info.st_mode) or info.st_uid!=uid or info.st_mode&0o022:raise CheckFailed(check)
        if self.journal.exists() or self.journal.is_symlink() or self.paused.exists() or self.paused.is_symlink():raise CheckFailed('operation_in_progress')
        read_step('sending_marker')
        try:marker=safe_stat(FLAG,0)
        except OSError:raise CheckFailed('sending_marker') from None
        for name,check in [(self.backup,'rollback_name'),(NAME+'-failed-'+self.revision[:12],'failed_name')]:
            read_step(check)
            if command(['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.ID}}']).strip():raise CheckFailed(check)
        return marker

    def preflight(self):
        global STAGE
        STAGE='preflight'
        if os.geteuid()!=0:raise ValueError('Root operator context required')
        self.check_paths()
        image_check();app_check();provider=provider_check()
        inspect_config(NAME,OLD_REV,OLD_IMAGE);check_source_health(OLD_REV,OLD_SOURCE,True)
        read_step('revision_marker')
        if metadata.marker()!=OLD_REV:raise ValueError('Mail revision differs')
        safe_stat(DB,10000)
        wal,shm=Path(str(DB)+'-wal'),Path(str(DB)+'-shm')
        if wal.exists() or shm.exists():safe_stat(wal,10000);safe_stat(shm,10000)
        identity=mail_identity();identity.__enter__()
        db=None
        try:
            db=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=5)
            db.execute('PRAGMA query_only=ON')
            deadline=time.monotonic()+10;db.set_progress_handler(lambda:int(time.monotonic()>deadline),1000)
            inflight=db.execute("SELECT count(*) FROM messages WHERE status IN ('submitting','accepted','delayed','review')").fetchone()[0]
            if db.total_changes:raise ValueError('Read-only count changed data')
        finally:
            if db is not None:db.close()
            identity.__exit__(None,None,None)
        read_step('postfix_spool_count')
        raw=command(['docker','exec',NAME,'postqueue','-j'],timeout=10)
        spool=0
        for line in raw.splitlines():
            if not isinstance(json.loads(line),dict):raise ValueError('Queue count invalid')
            spool+=1
            if spool>10000:raise ValueError('Queue count bound')
        return {'read_only':True,'config_match':True,'source_match':True,**provider,
                'inflight_count':inflight,'spool_count':spool,'quiescent_snapshot':inflight==0 and spool==0,
                'snapshot_is_not_restart_authorization':True}

    def run(self):
        global STAGE,FAILED_STAGE
        if os.geteuid()!=0:raise ValueError('Root operator context required')
        self.check_paths()
        # Revalidation occurs both before build and under exclusive lock.
        STAGE='app_provider';provider_check()
        STAGE='prebuild';image_check();app_check();inspect_config(NAME,OLD_REV,OLD_IMAGE);check_source_health(OLD_REV,OLD_SOURCE,True)
        if metadata.marker()!=OLD_REV:raise ValueError('Revision marker differs')
        self.build()
        fd=os.open('/run/lock/becore-tickets-deploy.lock',os.O_RDONLY|os.O_NOFOLLOW)
        try:
            lock=os.fstat(fd)
            if not stat.S_ISREG(lock.st_mode) or lock.st_uid!=0:raise ValueError('Unsafe lock')
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.check_paths()
            STAGE='app_provider';provider_check()
            STAGE='locked_preflight';app_check();inspect_config(NAME,OLD_REV,OLD_IMAGE);check_source_health(OLD_REV,OLD_SOURCE,True)
            if metadata.marker()!=OLD_REV:raise ValueError('Revision marker changed')
            self.marker_identity=safe_stat(FLAG,0)
            self.record('prepared')
            try:
                STAGE='fenced_stop'
                with self.fence(NAME):
                    self.pause();self.record('stop_boundary')
                    self.stop_attempted=True
                    command(['docker','stop','--time','30',NAME],timeout=40)
                    inspect_config(NAME,OLD_REV,OLD_IMAGE,running=False)
                    self.stop_confirmed=True;self.old_stopped=True
                    command(['docker','rename',NAME,self.backup]);self.renamed=True
                    self.record('old_retained')
                STAGE='paused_start';self.start()
                inspect_config(NAME,self.revision,self.image)
                wait_ready(self.revision,NEW_SOURCE,False);self.verify_schema()
                STAGE='enable';self.enable(self.revision)
                check_source_health(self.revision,NEW_SOURCE,True)
                inspect_config(NAME,self.revision,self.image)
                self.record('verified')
            except Exception:
                FAILED_STAGE=STAGE
                STAGE='rollback_guard'
                try:self.rollback()
                except Exception:
                    STAGE='manual_reconciliation_required'
                    self.record('manual_reconciliation_required')
                    raise RuntimeError('Rollback requires reconciliation') from None
                STAGE=FAILED_STAGE
                raise
        finally:os.close(fd)


if __name__=='__main__':
    try:
        if len(sys.argv)!=3 or sys.argv[1] not in ('--approved-mail-upgrade','--preflight'):raise ValueError('Explicit reviewed operator invocation required')
        source=sys.stdin.buffer.read(262145)
        operation=Upgrade(sys.argv[2],source)
        if sys.argv[1]=='--preflight':print(json.dumps(operation.preflight(),sort_keys=True))
        else:
            operation.run()
            print(json.dumps({'ok':True,'mail_only_upgrade':True,'test_messages_sent':0}))
    except Exception as error:
        print(json.dumps(failure_report(error,len(sys.argv)>1 and sys.argv[1]=='--preflight'),sort_keys=True),file=sys.stderr);sys.exit(1)
