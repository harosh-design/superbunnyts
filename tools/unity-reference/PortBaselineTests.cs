using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
using UnityEditor;
namespace SuperBunny.Tests {
 public class PortBaselineTests {
  static string Output => System.Environment.GetEnvironmentVariable("SUPER_BUNNY_PORT_OUTPUT") ?? Path.GetFullPath(Path.Combine(Application.dataPath,".."));
  [Serializable] public class State { public string name; public float x,y,a,vx,vy,w; public float mass,inertia,cx,cy; public State(Rigidbody2D b) {name=b.name;x=b.position.x;y=b.position.y;a=b.rotation*Mathf.Deg2Rad;vx=b.linearVelocity.x;vy=b.linearVelocity.y;w=b.angularVelocity*Mathf.Deg2Rad;mass=b.mass;inertia=b.inertia;cx=b.centerOfMass.x;cy=b.centerOfMass.y;} }
  [Serializable] public class Tick { public State core; public bool grounded; public int holding; public Tick(BunnyRig r){core=new State(r.Core);grounded=r.Motor.Grounded;holding=(r.Grab.IsHolding(0)?1:0)+(r.Grab.IsHolding(1)?1:0);} }
  [Serializable] public class Trace { public string name;public State[] initial;public State[] props;public List<Tick> ticks=new(); }
  [Serializable] public class Report {public string unity;public float dt,gravity;public List<Trace> scenarios=new();public List<State> shapes=new();}
  [Serializable] public class Visual {public string name,mesh;public Vector3 position,scale;public Quaternion rotation;public Color color;}
  [Serializable] public class Scenery {public List<Visual> objects=new();public Color ambientSky,ambientGround;}
  [UnityTest] public IEnumerator Capture() {
   var report=new Report {unity=Application.unityVersion};
   foreach(var name in new[]{"flat_idle","flat_jump","flat_right","flat_left","lab_idle"}) {
    var scene=SceneManager.CreateScene("PortBaseline_"+name);SceneManager.SetActiveScene(scene);
    var tuning=AssetDatabase.LoadAssetAtPath<BunnyTuning>("Assets/_Project/Data/BunnyTuning.asset");
    var floor=new GameObject("Floor");floor.layer=PhysicsLayers.Terrain;floor.transform.position=new Vector3(0,-1.5f);floor.AddComponent<BoxCollider2D>().size=new Vector2(16,3);
    if(name=="lab_idle"){var g=new GameObject("Bag");g.transform.position=new Vector3(1.1f,3.6f);g.AddComponent<HangingPunchingBag>().Build();}
    var input=new ScriptedBunnyInput();var rig=BunnyRig.Spawn(tuning,new Vector2(-1.4f,0),0,input);rig.Life.HeadImpactKills=false;
    var trace=new Trace {name=name};trace.initial=rig.Bodies.ConvertAll(b=>new State(b)).ToArray();trace.props=UnityEngine.Object.FindObjectsByType<Rigidbody2D>().Where(b=>!rig.Bodies.Contains(b)).Select(b=>new State(b)).ToArray();
    report.dt=Time.fixedDeltaTime;report.gravity=Physics2D.gravity.y;
    for(int i=0;i<150;i++){
     input.Roll=i>=20?(name=="flat_right"?1:name=="flat_left"?-1:0):0;
     if(name=="flat_jump"&&i==30)input.PressJump();
     yield return new WaitForFixedUpdate();trace.ticks.Add(new Tick(rig));
    }
    report.scenarios.Add(trace);
    var empty=SceneManager.CreateScene("PortCleanup_"+name);SceneManager.SetActiveScene(empty);
    rig.gameObject.SetActive(false);yield return SceneManager.UnloadSceneAsync(scene);
   }
   foreach(var spec in new[]{new Vector3(.08f,.4f,.25f),new Vector3(.12f,.4f,.3f),new Vector3(.7f,1.35f,4f),new Vector3(.16f,.11f,1.2f)}){
    var go=new GameObject($"capsule-{spec.x}-{spec.y}");go.transform.position=new Vector3(0,100,0);var rb=go.AddComponent<Rigidbody2D>();rb.mass=spec.z;
    var col=go.AddComponent<CapsuleCollider2D>();col.size=new Vector2(spec.x,spec.y);col.direction=spec.x>spec.y?CapsuleDirection2D.Horizontal:CapsuleDirection2D.Vertical;
    Physics2D.SyncTransforms();report.shapes.Add(new State(rb));UnityEngine.Object.Destroy(go);
   }
   File.WriteAllText(Path.Combine(Output,"port-baseline.json"),JsonUtility.ToJson(report,true));
   Assert.That(report.scenarios.Count,Is.EqualTo(5));
  }
 }
}
