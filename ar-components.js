/* global AFRAME  */

AFRAME.registerComponent("hide-in-ar-mode", {
	// Set this object invisible while in AR mode.
	// TODO: could this be replaced with bind="visible: !ar-mode"
	// with https://www.npmjs.com/package/aframe-state-component ?
	init: function () {
		this.el.sceneEl.addEventListener("enter-vr", () => {
			if (this.el.sceneEl.is("ar-mode")) {
				this.el.setAttribute("visible", false);
			}
		});
		this.el.sceneEl.addEventListener("exit-vr", () => {
			this.el.setAttribute("visible", true);
		});
	},
});

AFRAME.registerComponent("occlusion-material", {
	update: function () {
		this.el.components.material.material.colorWrite = false;
	},
});


class HitTest {
	constructor(renderer, options) {

		this.renderer = renderer;
		this.xrHitTestSource = null;

		renderer.xr.addEventListener("sessionend", () => this.xrHitTestSource = null);
		renderer.xr.addEventListener("sessionstart", () => this.sessionStart(options));
		
		if (this.renderer.xr.isPresenting) {
			this.sessionStart(options)
		}
	}

	async sessionStart(options) {
		this.session = this.renderer.xr.getSession();
		
		if (options.space) {
			this.space = options.space;
			this.xrHitTestSource = await this.session.requestHitTestSource(options);
		} else if ( options.profile ) {
			this.transient = true;
			this.xrHitTestSource = await this.session.requestHitTestSourceForTransientInput(options);
		}
	}

	doHit(frame) {
		if (!this.renderer.xr.isPresenting) return;
		const refSpace = this.renderer.xr.getReferenceSpace();
		const xrViewerPose = frame.getViewerPose(refSpace);

		if (this.xrHitTestSource && xrViewerPose) {

			if (this.transient) {
				const hitTestResults = frame.getHitTestResultsForTransientInput(this.xrHitTestSource);
				if (hitTestResults.length > 0) {
					const results = hitTestResults[0].results;
					if (results.length > 0) {
						const pose = results[0].getPose(refSpace);
						return {
							inputSpace: hitTestResults[0].inputSource.targetRaySpace,
							pose
						};
					} else {
						return false
					}
				} else {
					return false;
				}
			} else {
				const hitTestResults = frame.getHitTestResults(this.xrHitTestSource);
				if (hitTestResults.length > 0) {
					const pose = hitTestResults[0].getPose(refSpace);
					return {
						pose,
						inputSpace: this.space
					};
				} else {
					return false;
				}
			}
		}
	}
}

// Usage
// Needs the master version of AFrame and the hit-test optional feature
// Add ar-hit-test to the reticle
const hitTestCache = new Map();
AFRAME.registerComponent("ar-hit-test", {
	schema: {
		target: { type: "selector" },
		doHitTest: { default: true }
	},

	init: function () {
		this.hitTest = null;
		this.hasFoundAPose = false;

		this.el.sceneEl.renderer.xr.addEventListener("sessionend", () => {
			this.hitTest = null;
			this.hasFoundAPose = false;
		});

		this.el.sceneEl.renderer.xr.addEventListener("sessionstart", async () => {
			const renderer = this.el.sceneEl.renderer;
			const session = this.session = renderer.xr.getSession();
			this.hasFoundAPose = false;

			// Default to selecting through the face
			const viewerSpace = await session.requestReferenceSpace('viewer');
			const viewerHitTest = new HitTest(renderer, {
				space: viewerSpace
			});
			this.hitTest = viewerHitTest;

			// These are transient inputs so need to be handled seperately
			const profileToSupport = "generic-touchscreen";
			const transientHitTest = new HitTest(renderer, {
				profile: profileToSupport,
			});

			session.addEventListener('selectstart', ({ inputSource }) => {
				if (!this.data.doHitTest) return;
				if (inputSource.profiles[0] === profileToSupport) {
					this.hitTest = transientHitTest;
				} else {
					this.hitTest = hitTestCache.get(inputSource) || new HitTest(renderer, {
						space: inputSource.targetRaySpace
					});
					hitTestCache.set(inputSource, this.hitTest);
				}
				this.el.setAttribute('visible', true);
			});

			session.addEventListener('selectend', ({ inputSource }) => {
				this.needsSelectEventForInputSource = inputSource;

				if (!this.data.doHitTest) return;

				if (this.hasFoundAPose) {

					this.el.setAttribute('visible', false);

					this.hitTest = null;

					// For transient input sources fall back to viewer hit testing
					// after a short while after the transient input source is no longer available.
					// To give a consistent interaction experience
					if (inputSource.profiles[0] === profileToSupport) {
						setTimeout(() => {
							this.hitTest = viewerHitTest;
						}, 300);
					}
	
					if (this.data.target) {
						const target = this.data.target;				
						target.setAttribute("position", this.el.getAttribute("position"));
						target.object3D.quaternion.copy(this.el.object3D.quaternion);
						target.setAttribute("visible", true);
					}

				}
			});
		});
	},
	tick: function () {
		const frame = this.el.sceneEl.frame;

		if (!frame) return;

		if (this.needsSelectEventForInputSource) {
			const inputSource = this.needsSelectEventForInputSource;
			this.needsSelectEventForInputSource = false;

			const space = inputSource.targetRaySpace;
			try {
				const pose = frame.getPose(space, this.el.sceneEl.renderer.xr.getReferenceSpace());
				this.el.emit('select', { inputSource, pose });
			} catch (e) {
				console.log(e);
			}
		}

		if (this.hitTest && this.data.doHitTest) {
			const result = this.hitTest.doHit(frame);
			if (result) {

				const { pose, inputSpace } = result;

				this.hasFoundAPose = true;
				try {
					this.currentControllerPose = frame.getPose(inputSpace, this.el.sceneEl.renderer.xr.getReferenceSpace());
				} catch (e) {
					console.log(e);
				}

				this.el.setAttribute('visible', true);
				this.el.setAttribute("position", pose.transform.position);
				this.el.object3D.quaternion.copy(pose.transform.orientation);
			}
		}
	},
});

AFRAME.registerPrimitive('a-hit-test', {
    defaultComponents: {
        'ar-hit-test': {}
    },
    mappings: {
        target: 'ar-hit-test.target',
    }
});
