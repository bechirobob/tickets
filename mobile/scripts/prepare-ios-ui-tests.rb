# Add a test-only target to the CI checkout. The release app and its signing
# configuration remain the same; XCTest drives the actual URL/scene bridge.
require 'xcodeproj'

project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = project.targets.find { |target| target.name == 'App' }
raise 'App target is missing' unless app
raise 'UI test target already exists' if project.targets.any? { |target| target.name == 'EventLinksUITests' }

tests = project.new_target(:ui_test_bundle, 'EventLinksUITests', :ios, '16.4')
tests.add_dependency(app)
source = project.main_group.new_file('../../tests/ios/EventLinksUITests.swift')
tests.source_build_phase.add_file_reference(source)
tests.build_configurations.each do |config|
  config.build_settings.merge!({
    'SWIFT_VERSION' => '5.0',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'PRODUCT_NAME' => 'EventLinksUITests',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.becoreops.tickets.uitests',
    'TEST_TARGET_NAME' => 'App',
    'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'ONLY_ACTIVE_ARCH' => 'YES'
  })
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(tests, false)
scheme.add_test_target(tests)
scheme.set_launch_target(app)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(project.path, 'NativeAcceptance')
