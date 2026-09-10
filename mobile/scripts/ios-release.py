"""Validate iPhone builds and prepare isolated Apple distribution signing."""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys

MOBILE = Path(__file__).resolve().parents[1]
IOS = MOBILE / 'ios'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Never echo subprocess arguments/output: signing commands can contain credentials.
    require(result.returncode == 0, f'{Path(args[0]).name} failed; sensitive command output withheld')
    return result.stdout


def identity():
    data = json.loads((IOS / 'release.json').read_text())
    require(data.get('bundleId') == 'com.becoreops.tickets', 'Unexpected iOS application identity')
    require(re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', data.get('version', '')), 'Invalid iOS version')
    require(type(data.get('build')) is int and 1 <= data['build'] <= 999999999, 'Invalid iOS build number')
    require(data.get('minimumIOS') == '15.0', 'Review minimum iOS changes explicitly')
    config = (IOS / 'release.xcconfig').read_text()
    for key, value in [('BUNDLE_ID', data['bundleId']), ('VERSION', data['version']), ('BUILD', data['build']), ('MINIMUM_IOS', data['minimumIOS'])]:
        require(re.search(rf'^BECORE_{key} = {re.escape(str(value))}$', config, re.M), 'release.xcconfig differs from release.json')
    return data


def successor(current, previous):
    require(current['bundleId'] == previous['bundleId'], 'Cannot change published bundle ID')
    require(current['build'] > previous['build'], 'Published iOS build numbers must increase')
    require(tuple(map(int, current['version'].split('.'))) >= tuple(map(int, previous['version'].split('.'))), 'Cannot decrease published version')


def validate_profile(profile, team, bundle, now=None):
    require(re.fullmatch(r'[A-Z0-9]{10}', team or ''), 'Apple team ID is missing or invalid')
    require(re.fullmatch(r'[A-Fa-f0-9-]{36}', profile.get('UUID', '')), 'Invalid provisioning profile UUID')
    require(profile.get('TeamIdentifier') == [team], 'Provisioning profile belongs to another team')
    expiration = profile.get('ExpirationDate')
    require(isinstance(expiration, dt.datetime), 'Profile expiration is missing')
    require(expiration.replace(tzinfo=dt.timezone.utc) > (now or dt.datetime.now(dt.timezone.utc)), 'Provisioning profile expired')
    ent = profile.get('Entitlements', {})
    prefixes = profile.get('ApplicationIdentifierPrefix', [])
    require(len(prefixes) == 1 and re.fullmatch(r'[A-Z0-9]{10}', prefixes[0]), 'Invalid app identifier prefix')
    require(ent.get('application-identifier') == f'{prefixes[0]}.{bundle}', 'Profile must explicitly match this app')
    require(ent.get('com.apple.developer.team-identifier') == team, 'Entitlement team mismatch')
    require(ent.get('get-task-allow') is False, 'Development provisioning profiles cannot ship')
    require('ProvisionedDevices' not in profile and not profile.get('ProvisionsAllDevices'), 'Use an App Store distribution profile')
    require(profile.get('DeveloperCertificates'), 'Profile contains no signing certificate')
    return profile['UUID']


def validate_app(info, config, platform):
    expected = identity()
    require(info.get('CFBundleIdentifier') == expected['bundleId'], 'Built bundle ID mismatch')
    require(info.get('CFBundleShortVersionString') == expected['version'], 'Built version mismatch')
    require(info.get('CFBundleVersion') == str(expected['build']), 'Built build-number mismatch')
    require(info.get('MinimumOSVersion') == expected['minimumIOS'], 'Built minimum OS mismatch')
    require(info.get('UIDeviceFamily') == [1], 'Build must target iPhone')
    require(info.get('DTPlatformName') == platform, 'Wrong Apple build platform')
    require(int(str(info.get('DTXcode', '0'))) >= 2600, 'Xcode 26 or newer required')
    require(re.match(rf'^{platform}(2[6-9]|[3-9]\d)\.', info.get('DTSDKName', '')), 'iOS 26 SDK or newer required')
    require(str(info.get('CAPACITOR_DEBUG', '')).lower() == 'false', 'Release web debugging must be disabled')
    require(info.get('ITSAppUsesNonExemptEncryption') is False, 'Encryption declaration needs review')
    require(not info.get('NSAppTransportSecurity', {}).get('NSAllowsArbitraryLoads'), 'Insecure network exception')
    require(config.get('appId') == expected['bundleId'], 'Packaged Capacitor identity mismatch')
    require(not config.get('server', {}).get('url'), 'Live-reload server cannot ship')
    require(not config.get('ios', {}).get('webContentsDebuggingEnabled'), 'Web inspector cannot ship')


def check_app(app, platform, signed=False):
    app = Path(app)
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    config = json.loads((app / 'capacitor.config.json').read_text())
    validate_app(info, config, platform)
    privacy = plistlib.loads((app / 'PrivacyInfo.xcprivacy').read_bytes())
    require(privacy.get('NSPrivacyTracking') is False, 'Unexpected tracking declaration')
    require((app / 'public/index.html').is_file(), 'Packaged client is missing')
    require(any((app / 'public/assets').glob('*.js')), 'Packaged JavaScript is missing')
    binary = app / info['CFBundleExecutable']
    require('arm64' in run('xcrun', 'lipo', '-archs', str(binary)).decode(), 'Missing arm64 executable')
    if signed:
        run('codesign', '--verify', '--deep', '--strict', str(app))
        ent = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(app)))
        profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')))
        team = os.environ.get('IOS_TEAM_ID', '')
        validate_profile(profile, team, identity()['bundleId'])
        require(ent.get('get-task-allow') is False, 'Signed app permits debugger attachment')
        require(ent.get('application-identifier') == profile['Entitlements']['application-identifier'], 'Signed app identity differs from profile')
        require(ent.get('com.apple.developer.team-identifier') == team, 'Signed app belongs to another team')
    print(f'Validated {platform} release: {identity()["version"]} ({identity()["build"]})')


def private_file(path, data):
    with open(path, 'xb') as output:
        os.chmod(path, 0o600)
        output.write(data)


def signing_dir():
    return Path(os.environ['RUNNER_TEMP']) / 'becore-ios-signing'


def cleanup():
    folder = signing_dir()
    if not folder.exists():
        return
    keychain = folder / 'signing.keychain-db'
    subprocess.run(['security', 'delete-keychain', str(keychain)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    marker = folder / 'profile-path.txt'
    if marker.exists():
        Path(marker.read_text()).unlink(missing_ok=True)
    shutil.rmtree(folder)


def prepare():
    values = {key: os.environ.get(key, '') for key in ['IOS_DISTRIBUTION_P12_BASE64', 'IOS_DISTRIBUTION_P12_PASSWORD', 'IOS_PROVISIONING_PROFILE_BASE64', 'IOS_TEAM_ID']}
    require(all(values.values()), 'Apple distribution credentials are missing; complete organization enrollment first')
    folder = signing_dir()
    folder.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        certificate = folder / 'distribution.p12'
        profile_file = folder / 'distribution.mobileprovision'
        for path, key in [(certificate, 'IOS_DISTRIBUTION_P12_BASE64'), (profile_file, 'IOS_PROVISIONING_PROFILE_BASE64')]:
            data = base64.b64decode(values[key], validate=True)
            require(0 < len(data) < 100000, 'Signing file has an invalid size')
            private_file(path, data)
        profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile_file)))
        uuid = validate_profile(profile, values['IOS_TEAM_ID'], identity()['bundleId'])
        password = os.urandom(32).hex()
        keychain = str(folder / 'signing.keychain-db')
        run('security', 'create-keychain', '-p', password, keychain)
        run('security', 'set-keychain-settings', '-lut', '21600', keychain)
        run('security', 'unlock-keychain', '-p', password, keychain)
        run('security', 'import', str(certificate), '-P', values['IOS_DISTRIBUTION_P12_PASSWORD'], '-t', 'cert', '-f', 'pkcs12', '-k', keychain, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
        run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:', '-k', password, keychain)
        run('security', 'list-keychains', '-d', 'user', '-s', keychain)
        identities = run('security', 'find-identity', '-v', '-p', 'codesigning', keychain).decode()
        matches = re.findall(r'\b([A-F0-9]{40})\b', identities)
        permitted = {hashlib.sha1(cert).hexdigest().upper() for cert in profile['DeveloperCertificates']}
        matches = [value for value in matches if value in permitted]
        require(len(matches) == 1, 'Certificate/private key must match the provisioning profile')
        destination = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles' / f'{uuid}.mobileprovision'
        destination.parent.mkdir(parents=True, exist_ok=True)
        require(not destination.exists(), 'Refusing to replace an existing provisioning profile')
        private_file(folder / 'profile-path.txt', str(destination).encode())
        private_file(destination, profile_file.read_bytes())
        options = {'method': 'app-store-connect', 'destination': 'export', 'signingStyle': 'manual', 'teamID': values['IOS_TEAM_ID'], 'signingCertificate': matches[0], 'provisioningProfiles': {identity()['bundleId']: uuid}, 'manageAppVersionAndBuildNumber': False, 'stripSwiftSymbols': True, 'uploadSymbols': True}
        private_file(folder / 'ExportOptions.plist', plistlib.dumps(options))
        with open(os.environ['GITHUB_ENV'], 'a') as env:
            env.write(f'BECORE_PROFILE_UUID={uuid}\nBECORE_SIGN_IDENTITY={matches[0]}\n')
        print('Apple distribution identity and profile verified; isolated keychain prepared')
    except Exception:
        cleanup()
        raise ValueError('Apple signing setup failed; private material removed and details withheld') from None


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'validate':
            current = identity()
            if len(sys.argv) > 2:
                successor(current, json.loads(Path(sys.argv[2]).read_text()))
            print(f'iOS identity validated: {current["version"]} ({current["build"]})')
        elif command == 'verify-app':
            check_app(sys.argv[2], sys.argv[3], '--signed' in sys.argv)
        elif command == 'prepare-signing':
            prepare()
        elif command == 'cleanup':
            cleanup()
        else:
            raise ValueError('Unknown iOS release command')
    except Exception as error:
        print(f'iOS release blocked: {error}', file=sys.stderr)
        sys.exit(1)
