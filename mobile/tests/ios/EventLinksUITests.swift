import XCTest

final class EventLinksUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.becoreops.tickets")

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func assertEvent(_ title: String, evidence: String) {
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        let poster = app.webViews.images["Event poster for \(title)"]
        XCTAssertTrue(poster.waitForExistence(timeout: 30), "The native event page must replace Home")
        XCTAssertTrue(app.webViews.buttons["Share"].exists, "Event actions must be present")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = evidence
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testColdEventLink() {
        app.terminate()
        app.open(URL(string: "becoretickets://event/sun-chasers-labadi")!)
        assertEvent("On The Guest List", evidence: "iphone-cold-event-link")
    }

    func testWarmEventLinksChangeDestination() {
        app.launch()
        app.open(URL(string: "becoretickets://event/sun-chasers-labadi")!)
        assertEvent("On The Guest List", evidence: "iphone-warm-event-link")
        app.open(URL(string: "becoretickets://event/the-weekend-braai")!)
        XCTAssertTrue(app.webViews.buttons["Back to The Drop"].waitForExistence(timeout: 30), "Removed event links must show the unavailable page")
        XCTAssertFalse(app.webViews.images["Event poster for The Weekend Braai — Birthday Edition"].exists)
        XCTAssertFalse(app.webViews.images["Event poster for On The Guest List"].exists, "The previous event must not remain on screen")
        let removed = XCTAttachment(screenshot: app.screenshot())
        removed.name = "iphone-removed-event-link"
        removed.lifetime = .keepAlways
        add(removed)
        app.open(URL(string: "becoretickets://event/sun-chasers-labadi")!)
        assertEvent("On The Guest List", evidence: "iphone-second-event-link")
        XCTAssertFalse(app.webViews.images["Event poster for The Weekend Braai — Birthday Edition"].exists)
    }
}
