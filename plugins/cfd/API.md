# CFD authoring API

The native object type is cfd. Its ordinary parameters are Speed (finite, >=0, m/s), Medium (Air/Water), Altitude (finite metres) and Ground (None/Road). Defaults are 20, Air, 0, None. Field metadata is declared once in plugin.json and native authoring validates before mutation.

- plugins.create {plugin:'cfd'} creates a native CFD owner.
- scene.update {id,params} uses the normal editor transaction.
- fields.list/read/write use the common field adapter, its revision checks and native authoring rules. Animated observations follow the shared adapter's write restrictions; there is no CFD-specific bypass.
- plugins.describe {plugin:'cfd'} discovers operation schemas and readOnly metadata.
- plugins.command {id,operation:'status',args:{}} reads detached authoring values only.

status has additionalProperties:false in its empty argument schema. Its result contains stage:'authoring-preview', state:'under-construction', authoringOnly:true, solverAvailable:false, resultsAvailable:false, geometryDiagnosticAvailable:false and geometryEvaluated:false. registeredTags is empty. localBox is in millimetres and flow.directionLocal is [1,0,0]. parameters is a detached copy. geometryParticipation:'planned-automatic-box-intersection' states future intent; no geometry is evaluated.

solve-frame, solve-animation and results are read-only rejection contracts. They accept an object solely to return the explicit CFD_AUTHORING_ONLY error before any numerical work or mutation; they are not callable solver implementations. The error text states that no flow, force, pressure or separation is calculated. They have no UI buttons.

No force/pressure/drag/separation/streamline values, SI density, Reynolds number, solver settings, GPU budget or geometry-readiness certificate are returned.
