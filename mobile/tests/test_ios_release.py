import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ios_release', Path(__file__).parents[1] / 'scripts/ios-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.profile = {'UUID':'12345678-1234-1234-1234-123456789ABC','TeamIdentifier':['ABCDE12345'],'ApplicationIdentifierPrefix':['ABCDE12345'],'ExpirationDate':dt.datetime(2099,1,1),'DeveloperCertificates':[b'fixture'], 'Entitlements':{'application-identifier':'ABCDE12345.com.becoreops.tickets','com.apple.developer.team-identifier':'ABCDE12345','get-task-allow':False}}
        current = release.identity()
        self.info = {'CFBundleIdentifier':current['bundleId'],'CFBundleShortVersionString':current['version'],'CFBundleVersion':str(current['build']),'MinimumOSVersion':'15.0','UIDeviceFamily':[1],'DTPlatformName':'iphoneos','DTXcode':'2600','DTSDKName':'iphoneos26.0','CAPACITOR_DEBUG':'false','ITSAppUsesNonExemptEncryption':False}
        self.config = {'appId':current['bundleId']}

    def test_release_identity_and_app(self):
        release.validate_app(self.info,self.config,'iphoneos')
        release.validate_profile(self.profile,'ABCDE12345','com.becoreops.tickets')

    def test_reject_wrong_distribution_profiles(self):
        for key,value in [('TeamIdentifier',['OTHER12345']),('ExpirationDate',dt.datetime(2000,1,1)),('ProvisionedDevices',['device']),('ProvisionsAllDevices',True)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_profile({**self.profile,key:value},'ABCDE12345','com.becoreops.tickets')
        for key,value in [('application-identifier','ABCDE12345.*'),('get-task-allow',True),('com.apple.developer.team-identifier','OTHER12345')]:
            altered=copy.deepcopy(self.profile);altered['Entitlements'][key]=value
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_profile(altered,'ABCDE12345','com.becoreops.tickets')

    def test_reject_wrong_or_debug_bundles(self):
        for key,value in [('CFBundleIdentifier','com.other.app'),('CFBundleVersion','0'),('UIDeviceFamily',[1,2]),('DTPlatformName','iphonesimulator'),('DTXcode','1640'),('DTSDKName','iphoneos18.0'),('CAPACITOR_DEBUG','true')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_app({**self.info,key:value},self.config,'iphoneos')
        with self.assertRaises(ValueError):
            release.validate_app(self.info,{**self.config,'server':{'url':'http://localhost:5173'}},'iphoneos')

    def test_successor_preserves_identity_and_increments_build(self):
        current=release.identity()
        release.successor({**current,'build':current['build']+1},current)
        for change in [{'build':current['build']},{'version':'0.0.1','build':current['build']+1},{'bundleId':'com.other.app','build':current['build']+1}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                release.successor({**current,**change},current)

if __name__=='__main__':
    unittest.main()
