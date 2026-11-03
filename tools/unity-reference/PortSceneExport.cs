using System;using System.IO;using System.Linq;using System.Collections.Generic;using UnityEngine;using UnityEditor;using UnityEditor.SceneManagement;
namespace SuperBunny.EditorTools {
 public static class PortSceneExport {
  static string Output => System.Environment.GetEnvironmentVariable("SUPER_BUNNY_PORT_OUTPUT") ?? Path.GetFullPath(Path.Combine(Application.dataPath,".."));
  [Serializable]public class Visual {public string name,mesh;public Vector3 position,scale;public Quaternion rotation;public Color color;}
  [Serializable]public class Scenery {public List<Visual> objects=new();}
  [Serializable]public class Block {public Vector2 position,size;public float angle;}
  [Serializable]public class VineData {public Vector2 top;public int segments;}
  [Serializable]public class SpringData {public Vector2 position;public float angle;}
  [Serializable]public class Arena {public string id;public List<Block> blocks=new(),hazards=new();public List<VineData> vines=new();public List<SpringData> springs=new();public Vector2[] spawns;public Rect kill,camera;}
  [Serializable]public class Arenas {public List<Arena> maps=new();}
  public static void Run(){var all=new Arenas();foreach(var id in new[]{"PhysicsLab","DM_Flat","DM_Meadow"}){
   EditorSceneManager.OpenScene("Assets/_Project/Scenes/"+id+".unity");var sc=new Scenery();
   foreach(var r in UnityEngine.Object.FindObjectsByType<MeshRenderer>()){
    if(r.GetComponentInParent<Rigidbody2D>()!=null||r.GetComponentInParent<SpringPad>()!=null)continue;
    var mf=r.GetComponent<MeshFilter>();if(mf==null||mf.sharedMesh==null)continue;var m=r.sharedMaterial;
    sc.objects.Add(new Visual{name=r.name,mesh=mf.sharedMesh.name,position=r.transform.position,rotation=r.transform.rotation,scale=r.transform.lossyScale,color=m!=null&&m.HasProperty("_BaseColor")?m.GetColor("_BaseColor"):Color.white});
   }
   File.WriteAllText(Path.Combine(Output,id+"-scenery.json"),JsonUtility.ToJson(sc,true));
   var b=UnityEngine.Object.FindAnyObjectByType<ArenaBounds>();var a=new Arena{id=id,kill=b.kill,camera=b.camera};
   a.spawns=UnityEngine.Object.FindObjectsByType<SpawnPoint>().OrderBy(p=>p.order).Select(p=>(Vector2)p.transform.position).ToArray();
   foreach(var c in UnityEngine.Object.FindObjectsByType<BoxCollider2D>())if(c.attachedRigidbody==null&&c.gameObject.layer==PhysicsLayers.Terrain)a.blocks.Add(new Block{position=c.transform.position,size=c.size,angle=c.transform.eulerAngles.z});
   foreach(var h in UnityEngine.Object.FindObjectsByType<Hazard>()) {var c=h.GetComponent<PolygonCollider2D>();if(c!=null){var sz=c.points;float minX=sz.Min(p=>p.x),maxX=sz.Max(p=>p.x),minY=sz.Min(p=>p.y),maxY=sz.Max(p=>p.y);a.hazards.Add(new Block{position=h.transform.position,size=new Vector2(maxX-minX,maxY-minY),angle=h.transform.eulerAngles.z});}}
   foreach(var s in UnityEngine.Object.FindObjectsByType<SpringPad>())a.springs.Add(new SpringData{position=s.transform.position,angle=s.transform.eulerAngles.z});
   foreach(var t in UnityEngine.Object.FindObjectsByType<Transform>())if(t.name=="Vine"){var bodies=t.GetComponentsInChildren<Rigidbody2D>();if(bodies.Length>0){var j=bodies[0].GetComponent<HingeJoint2D>();a.vines.Add(new VineData{top=j.connectedAnchor,segments=bodies.Length});}}
   all.maps.Add(a);
  }File.WriteAllText(Path.Combine(Output,"arenas.json"),JsonUtility.ToJson(all,true));Debug.Log("PORT_SCENES_EXPORTED");}
 }
}
